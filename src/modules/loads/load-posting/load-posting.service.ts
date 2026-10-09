import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { AuditService } from '../../audit/audit.service';
import { CustomerService } from '../../customers/customer.service';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadingPointEntity } from '../../masters/loading-point/entities/loading-point.entity';
import { ProductEntity } from '../../masters/product/entities/product.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { TruckTypeEntity } from '../../masters/truck-type/entities/truck-type.entity';
import { VehicleService, resolveDocumentStatus } from '../../masters/vehicle/vehicle.service';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../../masters/vehicle/vehicle.type';
import { DriverAuthService } from '../../driver/auth/driver-auth.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CodeSequenceRepository } from '../code-sequence.repository';
import { LoadRepository, CreateLoadData } from '../load.repository';
import { LoadActivityService } from '../load-activity.service';
import { LoadEntity } from '../entities/load.entity';
import { formatLoadCode } from '../utils/code.util';
import { LoadPostingRepository } from './load-posting.repository';
import { LoadPostingEntity } from './entities/load-posting.entity';
import { LoadRecipientEntity } from './entities/load-recipient.entity';
import { LoadDispatchNotifier } from './load-dispatch-notifier';
import {
  DropInput,
  NewAddressInput,
  PickupInput,
  PostLoadInput,
} from './utils/load-posting.interface';
import {
  DEFAULT_ADVANCE_PERCENTAGE,
  MIN_PICKUP_LEAD_HOURS,
  PostAddress,
} from './utils/load-posting.types';
import { buildPostMessage } from './utils/post-message';
import { driverUnavailableReason } from './utils/driver-availability';

const HOUR_MS = 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

/** Earliest allowed pickup: 3 hours from `now`, rounded up to the next half hour (PL-01 note 5). */
export function earliestPickup(now: Date): Date {
  const earliest = now.getTime() + MIN_PICKUP_LEAD_HOURS * HOUR_MS;
  return new Date(Math.ceil(earliest / HALF_HOUR_MS) * HALF_HOUR_MS);
}

interface ResolvedPlace {
  address: PostAddress;
  masterId: string | null;
  newAddress: NewAddressInput | null;
}

export interface PostLoadResult {
  posting: LoadPostingEntity;
  loads: { id: string; code: string }[];
  recipients: LoadRecipientEntity[];
  /** True when an earlier request with the same idempotency key already posted this load. */
  duplicate: boolean;
}

/**
 * Shipper "Post a load": one posting, one Load per truck, in a single transaction. Handles the
 * three modes — Market fleet (Loadsmart always + ticked transporters), Indent (one contracted
 * transporter at the contract rate) and Own fleet (one of the shipper's own trucks, straight to
 * the driver app). New masters typed on the form (customer-less pickup/drop addresses, unloading
 * points, commodities) are saved only here, so an abandoned or failed post saves nothing.
 *
 * Sending the message to transporters is behind LoadDispatchNotifier and happens after commit.
 */
export class LoadPostingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: LoadPostingRepository,
    private readonly loadRepository: LoadRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly customerService: CustomerService,
    private readonly vehicleService: VehicleService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly notifier: LoadDispatchNotifier,
    private readonly driverAuthService: DriverAuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async post(
    tenantId: string,
    actorId: string,
    role: string,
    input: PostLoadInput,
    idempotencyKey?: string,
  ): Promise<PostLoadResult> {
    try {
      // A double tap or client retry with the same key returns the first result, never a second load.
      if (idempotencyKey) {
        const existing = await this.repository.findPostingByIdempotencyKey(
          tenantId,
          idempotencyKey,
        );
        if (existing) return this.describeExisting(tenantId, existing);
      }

      // PL-13 — checked again here, not just in the picker.
      const pickupAt = new Date(input.pickupAt);
      if (pickupAt.getTime() < Date.now() + MIN_PICKUP_LEAD_HOURS * HOUR_MS) {
        throw new ValidationError(
          `Pickup must be at least ${MIN_PICKUP_LEAD_HOURS} hours from now`,
        );
      }

      const customer = input.customerId
        ? await this.assertCustomerUsable(tenantId, input.customerId)
        : null;
      const pickup = await this.resolvePickup(tenantId, input.pickup);
      const drop = await this.resolveDrop(tenantId, customer, input.drop);
      this.assertPlacesDiffer(pickup, drop);

      const trucks = await this.resolveTrucks(tenantId, input);
      const cargoPerTruck =
        input.weightTonnes === undefined ? null : input.weightTonnes / input.truckCount;

      let transporters: TransporterEntity[] = [];
      let contractRate: string | null = null;
      let contractId: string | null = null;
      let vehicleLoadDefaults: Partial<CreateLoadData> = {};

      if (input.mode === 'market_fleet') {
        const ids = [...new Set(input.transporterIds ?? [])];
        transporters = await this.repository.findActiveTransporters(tenantId, ids);
        if (transporters.length !== ids.length) {
          throw new ValidationError('One or more transporters were not found or are inactive');
        }
      } else if (input.mode === 'indent') {
        const contract = await this.assertIndentContract(tenantId, customer, pickup, drop, input);
        transporters = [contract.transporter];
        contractRate = contract.rate;
        contractId = contract.id;
      } else {
        vehicleLoadDefaults = await this.assertOwnFleetVehicle(
          tenantId,
          input.vehicleId!,
          input.driverId,
        );
      }

      const result = await this.dataSource.transaction(async (manager) => {
        const pickupMasterId = await this.savePickup(tenantId, actorId, role, pickup, manager);
        const drop2 = await this.saveDrop(tenantId, actorId, customer, drop, manager);
        const commodity = await this.resolveCommodity(tenantId, actorId, input, manager);

        const loadCodes: string[] = [];
        for (let i = 0; i < input.truckCount; i += 1) {
          loadCodes.push(
            formatLoadCode(await this.codeSequenceRepository.next('load', tenantId, manager)),
          );
        }

        const rate =
          contractRate ?? (input.price?.rate !== undefined ? String(input.price.rate) : null);
        const freightTotal = this.freightTotal(input, rate);
        const advance =
          input.mode === 'own_fleet'
            ? null
            : String(input.advancePercentage ?? DEFAULT_ADVANCE_PERCENTAGE);
        const balance = advance === null ? null : String(100 - Number(advance));

        const messageText =
          input.mode === 'own_fleet'
            ? null
            : buildPostMessage({
                mode: input.mode,
                loadCodes,
                pickup: pickup.address,
                drop: drop.address,
                pickupAt,
                deliverByAt: input.deliverByAt ? new Date(input.deliverByAt) : null,
                commodityName: commodity.name,
                packaging: input.packaging,
                weightTonnes: input.weightTonnes === undefined ? null : String(input.weightTonnes),
                truckCount: input.truckCount,
                truckLabels: trucks.labels,
                advancePercentage: advance,
                note: input.note ?? null,
              });

        const posting = await this.repository.createPosting(
          {
            tenantId,
            mode: input.mode,
            customerId: customer?.id ?? null,
            pickupLoadingPointId: pickupMasterId,
            pickupAddress: pickup.address,
            dropCustomerDeliveryPointId: drop2.customerDeliveryPointId,
            dropLoadingPointId: drop2.loadingPointId,
            dropAddress: drop.address,
            pickupAt,
            deliverByAt: input.deliverByAt ? new Date(input.deliverByAt) : null,
            commodityId: commodity.id,
            commodityName: commodity.name,
            packaging: input.packaging,
            weightTonnes: input.weightTonnes === undefined ? null : String(input.weightTonnes),
            truckCount: input.truckCount,
            truckTypeId: trucks.main?.id ?? null,
            truckLengthFt: input.truckLengthFt ?? null,
            acceptedTruckTypeIds: trucks.acceptedIds,
            vehicleId: input.vehicleId ?? null,
            priceMode: input.mode === 'market_fleet' ? input.price!.mode : null,
            priceBasis: input.mode === 'market_fleet' ? (input.price!.basis ?? null) : null,
            rate,
            freightTotal,
            contractId,
            advancePercentage: advance,
            balancePaidBy: input.mode === 'own_fleet' ? null : (input.balancePaidBy ?? 'shipper'),
            note: input.note ?? null,
            messageText,
            idempotencyKey: idempotencyKey ?? null,
            postedBy: actorId,
          },
          manager,
        );

        const plannedCapacity = String(
          cargoPerTruck ??
            Number(trucks.main?.capacityTons ?? vehicleLoadDefaults.plannedCapacityTonnes ?? 0),
        );
        const rows: CreateLoadData[] = loadCodes.map((code) => ({
          tenantId,
          code,
          postingId: posting.id,
          sourceType:
            input.mode === 'market_fleet'
              ? 'market'
              : input.mode === 'indent'
                ? 'indent'
                : 'own_fleet',
          status: input.mode === 'own_fleet' ? 'assigned' : 'created',
          plannedCapacityTonnes: plannedCapacity,
          truckTypeId: trucks.main?.id ?? null,
          feetWheels: input.truckLengthFt ?? null,
          freightType:
            input.mode === 'own_fleet'
              ? null
              : input.price?.basis === 'per_tonne'
                ? 'per_ton'
                : 'flat',
          freightMode:
            input.mode === 'market_fleet'
              ? input.price!.mode === 'ask_for_quotes'
                ? 'ask_for_quotes'
                : 'set_expected_price'
              : input.mode === 'indent'
                ? 'set_expected_price'
                : null,
          expectedRate: input.mode === 'own_fleet' ? null : rate,
          // Indent is already agreed: the contract rate is the freight and the transporter is known.
          freightValue: input.mode === 'indent' ? rate : null,
          transporterId: input.mode === 'indent' ? transporters[0].id : null,
          advancePercentage: advance,
          balancePercentage: balance,
          createdBy: actorId,
          ...(input.mode === 'own_fleet' ? vehicleLoadDefaults : {}),
        }));
        const loads = await this.loadRepository.createMany(rows, manager);

        if (commodity.id) {
          await this.loadRepository.createCargoItems(
            loads.map((load) => ({
              tenantId,
              loadId: load.id,
              productId: commodity.id!,
              tonnesPerTruck: plannedCapacity,
            })),
            manager,
          );
        }

        if (input.mode === 'own_fleet') {
          await this.vehicleService.setOperationalStatus(
            tenantId,
            actorId,
            input.vehicleId!,
            { operationalStatus: 'on_trip', reason: `Assigned to load ${loads[0].code}` },
            manager,
          );
        }

        const recipients =
          input.mode === 'own_fleet'
            ? []
            : await this.repository.createRecipients(
                [
                  ...(input.mode === 'market_fleet'
                    ? [
                        {
                          tenantId,
                          postingId: posting.id,
                          recipientType: 'loadsmart' as const,
                          transporterId: null,
                        },
                      ]
                    : []),
                  ...transporters.map((transporter) => ({
                    tenantId,
                    postingId: posting.id,
                    recipientType: 'transporter' as const,
                    transporterId: transporter.id,
                  })),
                ],
                manager,
              );

        for (const load of loads) {
          await this.loadActivityService.record(
            tenantId,
            load.id,
            actorId,
            'LOAD_CREATED',
            null,
            load.status,
            { postingId: posting.id, mode: input.mode },
            manager,
          );
        }

        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'LOAD_POSTED',
          resourceType: 'load',
          newData: { postingId: posting.id, mode: input.mode, loadCodes },
        });

        return { posting, loads, recipients };
      });

      // After commit — a delivery problem must never undo or fail a posted load.
      const recipients = await this.dispatch(
        tenantId,
        result.posting,
        result.recipients,
        transporters,
      );
      if (input.mode === 'own_fleet') await this.notifyDriver(tenantId, result.loads);

      return {
        posting: result.posting,
        loads: result.loads.map((load) => ({ id: load.id, code: load.code })),
        recipients,
        duplicate: false,
      };
    } catch (error) {
      rethrow(error, "Couldn't post the load. Check your connection and try again.");
    }
  }

  // --- Validation helpers ---

  private async assertCustomerUsable(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerEntity> {
    const [customer] = await this.repository.findCustomers(tenantId, [customerId]);
    if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);
    if (customer.status !== 'active' && customer.status !== 'pending') {
      throw new ConflictError(`Customer ${customerId} is not active`);
    }
    return customer;
  }

  private toAddress(
    label: string,
    fields: {
      addressLine1?: string | null;
      areaLocality?: string | null;
      city?: string | null;
      state?: string | null;
      pinCode?: string | null;
      latitude?: string | number | null;
      longitude?: string | number | null;
    },
    source: PostAddress['source'],
  ): PostAddress {
    return {
      label,
      addressLine1: fields.addressLine1 ?? null,
      areaLocality: fields.areaLocality ?? null,
      city: fields.city ?? null,
      state: fields.state ?? null,
      pinCode: fields.pinCode ?? null,
      latitude: fields.latitude == null ? null : Number(fields.latitude),
      longitude: fields.longitude == null ? null : Number(fields.longitude),
      source,
    };
  }

  private async resolvePickup(tenantId: string, pickup: PickupInput): Promise<ResolvedPlace> {
    if (pickup.newAddress) {
      return {
        address: this.toAddress(
          pickup.newAddress.label,
          pickup.newAddress,
          pickup.newAddress.source,
        ),
        masterId: null,
        newAddress: pickup.newAddress,
      };
    }
    const point = await this.repository.findLoadingPoint(tenantId, pickup.loadingPointId!);
    if (!point) throw new NotFoundError(`Loading point ${pickup.loadingPointId} not found`);
    return {
      address: this.toAddress(point.title, point, 'master'),
      masterId: point.id,
      newAddress: null,
    };
  }

  private async resolveDrop(
    tenantId: string,
    customer: CustomerEntity | null,
    drop: DropInput,
  ): Promise<ResolvedPlace> {
    if (drop.newAddress) {
      return {
        address: this.toAddress(drop.newAddress.label, drop.newAddress, drop.newAddress.source),
        masterId: null,
        newAddress: drop.newAddress,
      };
    }
    if (drop.customerDeliveryPointId) {
      if (!customer) throw new ValidationError('An unloading point needs a customer');
      const point = await this.repository.findUnloadingPoint(
        tenantId,
        customer.id,
        drop.customerDeliveryPointId,
      );
      if (!point)
        throw new NotFoundError(`Unloading point ${drop.customerDeliveryPointId} not found`);
      return {
        address: this.toAddress(point.location, point, 'master'),
        masterId: point.id,
        newAddress: null,
      };
    }
    if (customer) throw new ValidationError("Pick one of this customer's unloading points");
    const loadingPoint = await this.repository.findLoadingPoint(tenantId, drop.loadingPointId!);
    if (!loadingPoint) throw new NotFoundError(`Location ${drop.loadingPointId} not found`);
    return {
      address: this.toAddress(loadingPoint.title, loadingPoint, 'master'),
      masterId: loadingPoint.id,
      newAddress: null,
    };
  }

  /** PL-10 — "Pickup and drop can't be the same place." Same master row, or same pincode, street
   *  and city for typed addresses. */
  private assertPlacesDiffer(pickup: ResolvedPlace, drop: ResolvedPlace): void {
    const norm = (value: string | null) => (value ?? '').trim().toLowerCase();
    const same =
      (pickup.masterId !== null && pickup.masterId === drop.masterId) ||
      (norm(pickup.address.pinCode) !== '' &&
        norm(pickup.address.pinCode) === norm(drop.address.pinCode) &&
        norm(pickup.address.city) === norm(drop.address.city) &&
        norm(pickup.address.addressLine1 ?? pickup.address.label) ===
          norm(drop.address.addressLine1 ?? drop.address.label));
    if (same) throw new ValidationError("Pickup and drop can't be the same place");
  }

  private async resolveTrucks(
    tenantId: string,
    input: PostLoadInput,
  ): Promise<{ main: TruckTypeEntity | null; acceptedIds: string[]; labels: string[] }> {
    if (input.mode === 'own_fleet') {
      // The vehicle supplies the truck; a truck type is optional there.
      const main = input.truckTypeId
        ? ((await this.repository.findTruckTypes(tenantId, [input.truckTypeId]))[0] ?? null)
        : null;
      if (input.truckTypeId && !main) throw new NotFoundError('Truck type not found');
      return { main, acceptedIds: [], labels: [main?.name ?? 'Own truck'] };
    }

    const acceptedIds = [...new Set(input.acceptedTruckTypeIds ?? [])].filter(
      (id) => id !== input.truckTypeId,
    );
    const found = await this.repository.findTruckTypes(tenantId, [
      input.truckTypeId!,
      ...acceptedIds,
    ]);
    const main = found.find((type) => type.id === input.truckTypeId);
    if (!main) throw new NotFoundError('Truck type not found');
    const accepted = found.filter((type) => type.id !== main.id);
    if (accepted.length !== acceptedIds.length)
      throw new NotFoundError('Accepted truck type not found');

    // PL-16 — all accepted sizes share the main truck's body type (all open or all closed).
    const sameBody = accepted.every(
      (type) => type.bodyType !== null && type.bodyType === main.bodyType,
    );
    if (!sameBody) {
      throw new ValidationError('Also-accept sizes must have the same body type as the main truck');
    }
    return {
      main,
      acceptedIds: accepted.map((type) => type.id),
      labels: [main.name, ...accepted.map((type) => type.name)],
    };
  }

  /** PL-21 — only a transporter with a contract valid today on this lane can be indented; the
   *  rate is the contract's. */
  private async assertIndentContract(
    tenantId: string,
    customer: CustomerEntity | null,
    pickup: ResolvedPlace,
    drop: ResolvedPlace,
    input: PostLoadInput,
  ) {
    if (!customer) throw new ValidationError('Indent needs a customer with a contract');
    const contracts = await this.repository.listContracts(tenantId, customer.id);
    const today = new Date().toISOString().slice(0, 10);
    const match = contracts.find(
      (contract) =>
        contract.transporterId === input.transporterId &&
        contract.validFrom <= today &&
        contract.validTo >= today &&
        contract.pickupCity.toLowerCase() === (pickup.address.city ?? '').toLowerCase() &&
        contract.dropCity.toLowerCase() === (drop.address.city ?? '').toLowerCase(),
    );
    if (!match) {
      throw new ValidationError('This transporter has no valid contract on this lane');
    }
    if (match.transporter.status !== 'active') {
      throw new ConflictError('This transporter is not active');
    }
    return match;
  }

  /** PL-22 — a truck in the workshop, inactive or already on a live load cannot be picked;
   *  expiring papers never block. */
  private async assertOwnFleetVehicle(
    tenantId: string,
    vehicleId: string,
    pickedDriverId?: string,
  ): Promise<Partial<CreateLoadData>> {
    const vehicle = await this.vehicleService.getVehicle(tenantId, vehicleId);
    if (vehicle.status === 'under_maintenance') {
      throw new ConflictError('This truck is in the workshop and cannot be assigned');
    }
    if (vehicle.status !== 'active') throw new ConflictError('This truck is not active');
    const active = await this.loadRepository.findActiveByVehicles(tenantId, [vehicleId]);
    if (active.length > 0) {
      throw new ConflictError(`This truck is already on an active load (${active[0].code})`);
    }
    const primaryLink = (vehicle.driverLinks ?? []).find(
      (link) => link.isPrimary && link.status === 'active',
    );

    // The truck's linked driver goes first; a picked driver replaces them. Either way the driver
    // must be idle, and an own-fleet trip always needs one — it is delivered through the driver app.
    const driverId = pickedDriverId ?? primaryLink?.driverId;
    if (!driverId) {
      throw new ValidationError('This truck has no driver linked. Choose an idle driver.');
    }
    const [relation] = await this.repository.listDriverRelationsByDriverIds(tenantId, [driverId]);
    const busy = await this.repository.listDriverIdsOnActiveLoads(tenantId, [driverId]);
    const reason = driverUnavailableReason(relation, busy.has(driverId));
    if (reason) {
      throw new ConflictError(
        `${relation?.driver?.fullName ?? 'This driver'} is not available (${reason.replace('_', ' ')}). Choose an idle driver.`,
        { driverId, reason },
      );
    }
    return {
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.registrationNumber,
      driverId,
      driverNumber: relation.driver.phoneNumber,
      plannedCapacityTonnes: vehicle.capacityTons ?? '0',
    };
  }

  /** Warnings for the fleet picker — expired/expiring papers are shown, never blocking. */
  paperWarnings(documents: { documentType: string; expiryDate: string | null }[]): string[] {
    const withExpiry: readonly string[] = VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY;
    return documents
      .filter((document) => withExpiry.includes(document.documentType))
      .map((document) => ({ document, status: resolveDocumentStatus(document.expiryDate) }))
      .filter(({ status }) => status !== 'valid')
      .map(({ document, status }) => `${document.documentType} ${status.replace('_', ' ')}`);
  }

  // --- Writes ---

  private freightTotal(input: PostLoadInput, rate: string | null): string | null {
    if (rate === null) return null;
    if (input.mode === 'indent') return String(Number(rate) * input.truckCount);
    if (input.price?.basis === 'per_tonne') return String(Number(rate) * (input.weightTonnes ?? 0));
    return String(Number(rate) * input.truckCount);
  }

  private newLoadingPoint(
    tenantId: string,
    actorId: string,
    role: string,
    address: NewAddressInput,
  ): Partial<LoadingPointEntity> {
    const autoApproved = role === ORG_ADMIN_ROLE;
    return {
      tenantId,
      title: address.label.slice(0, 150),
      addressLine1: (address.addressLine1 ?? address.areaLocality ?? address.label).slice(0, 255),
      areaLocality: address.areaLocality ?? null,
      city: address.city,
      state: address.state,
      pinCode: address.pinCode,
      latitude: address.latitude === undefined ? null : String(address.latitude),
      longitude: address.longitude === undefined ? null : String(address.longitude),
      status: autoApproved ? 'active' : 'pending',
      approvedBy: autoApproved ? actorId : null,
      approvedAt: autoApproved ? new Date() : null,
      createdBy: actorId,
    };
  }

  private async savePickup(
    tenantId: string,
    actorId: string,
    role: string,
    pickup: ResolvedPlace,
    manager: EntityManager,
  ): Promise<string | null> {
    if (!pickup.newAddress) return pickup.masterId;
    const repo = manager.getRepository(LoadingPointEntity);
    const saved = await repo.save(
      repo.create({
        ...this.newLoadingPoint(tenantId, actorId, role, pickup.newAddress),
        deletedAt: null,
      }),
    );
    return saved.id;
  }

  /** PL-11 note 2 — a new drop becomes this customer's unloading point; with no customer it is
   *  one of the shipper's own saved locations (loading point master). */
  private async saveDrop(
    tenantId: string,
    actorId: string,
    customer: CustomerEntity | null,
    drop: ResolvedPlace,
    manager: EntityManager,
  ): Promise<{ customerDeliveryPointId: string | null; loadingPointId: string | null }> {
    if (!drop.newAddress) {
      return customer
        ? { customerDeliveryPointId: drop.masterId, loadingPointId: null }
        : { customerDeliveryPointId: null, loadingPointId: drop.masterId };
    }
    if (customer) {
      const repo = manager.getRepository(CustomerDeliveryPointEntity);
      const saved = await repo.save(
        repo.create({
          customerId: customer.id,
          tenantId,
          location: drop.newAddress.label.slice(0, 255),
          addressLine1: drop.newAddress.addressLine1 ?? null,
          areaLocality: drop.newAddress.areaLocality ?? null,
          city: drop.newAddress.city,
          state: drop.newAddress.state,
          pinCode: drop.newAddress.pinCode,
          deletedAt: null,
        }),
      );
      return { customerDeliveryPointId: saved.id, loadingPointId: null };
    }
    const repo = manager.getRepository(LoadingPointEntity);
    const saved = await repo.save(
      repo.create({
        ...this.newLoadingPoint(tenantId, actorId, ORG_ADMIN_ROLE, drop.newAddress),
        deletedAt: null,
      }),
    );
    return { customerDeliveryPointId: null, loadingPointId: saved.id };
  }

  /** PL-15 — masters first; an unknown name is added to the commodity master on post. */
  private async resolveCommodity(
    tenantId: string,
    actorId: string,
    input: PostLoadInput,
    manager: EntityManager,
  ): Promise<{ id: string | null; name: string }> {
    if (input.commodity.productId) {
      const product = await this.repository.findCommodity(
        tenantId,
        input.commodity.productId,
        manager,
      );
      if (!product) throw new NotFoundError(`Commodity ${input.commodity.productId} not found`);
      return { id: product.id, name: product.productDetails };
    }
    const name = input.commodity.name!.trim();
    const existing = await this.repository.findCommodityByExactName(tenantId, name, manager);
    if (existing) return { id: existing.id, name: existing.productDetails };
    // A commodity typed on Post a load is usable immediately for every role (shipper's call, not
    // the Product master's usual pending-approval step), so it shows up in the next search.
    const repo = manager.getRepository(ProductEntity);
    const saved = await repo.save(
      repo.create({
        tenantId,
        productDetails: name,
        packaging: input.packaging,
        approvalStatus: 'approved',
        status: 'active',
        createdBy: actorId,
        approvedBy: actorId,
        approvedAt: new Date(),
        deletedAt: null,
      }),
    );
    return { id: saved.id, name: saved.productDetails };
  }

  // --- After commit ---

  private async dispatch(
    tenantId: string,
    posting: LoadPostingEntity,
    recipients: LoadRecipientEntity[],
    transporters: TransporterEntity[],
  ): Promise<LoadRecipientEntity[]> {
    if (!recipients.length || !posting.messageText) return recipients;
    try {
      const results = await this.notifier.send({
        tenantId,
        postingId: posting.id,
        text: posting.messageText,
        recipients: recipients.map((recipient) => {
          const transporter = transporters.find((item) => item.id === recipient.transporterId);
          return {
            recipientId: recipient.id,
            type: recipient.recipientType,
            name: transporter?.name ?? 'Loadsmart',
            phone: transporter?.phone ?? null,
          };
        }),
      });
      for (const result of results) {
        const sentAt = result.status === 'sent' ? new Date() : null;
        await this.repository.setRecipientStatus(
          tenantId,
          result.recipientId,
          result.status,
          sentAt,
        );
        const recipient = recipients.find((item) => item.id === result.recipientId);
        if (recipient) {
          recipient.messageStatus = result.status;
          recipient.sentAt = sentAt;
        }
      }
    } catch (error) {
      console.error(`Failed to dispatch posting ${posting.id}`, error);
    }
    return recipients;
  }

  /** Same best-effort push as DispatchPlanningService.notifyAssignedDrivers. */
  private async notifyDriver(tenantId: string, loads: LoadEntity[]): Promise<void> {
    const load = loads[0];
    if (!load?.driverId) return;
    try {
      const sessions = await this.driverAuthService.getActiveDeviceTokensForDriver(load.driverId);
      await Promise.all(
        sessions
          .filter((session) => session.fcmToken)
          .map((session) =>
            this.notificationsService.send(tenantId, {
              recipientUserId: load.driverId!,
              type: 'load.assigned',
              title: 'New load assigned',
              body: `Load ${load.code} has been assigned to you`,
              channels: ['push'],
              destinations: { pushToken: session.fcmToken! },
              metadata: { loadIds: [load.id] },
            }),
          ),
      );
    } catch (error) {
      console.error(`Failed to notify driver ${load.driverId} of load ${load.code}`, error);
    }
  }

  private async describeExisting(
    tenantId: string,
    posting: LoadPostingEntity,
  ): Promise<PostLoadResult> {
    const loads = await this.repository.listLoadsByPosting(tenantId, posting.id);
    const recipients = await this.repository.listRecipients(tenantId, posting.id);
    return {
      posting,
      loads: loads.map((load) => ({ id: load.id, code: load.code })),
      recipients,
      duplicate: true,
    };
  }
}
