import { DataSource } from 'typeorm';
import { NotFoundError, rethrow } from '../../../shared/errors';
import { CustomerService } from '../../customers/customer.service';
import { VehicleService } from '../../masters/vehicle/vehicle.service';
import { LoadRepository } from '../load.repository';
import { LoadPostingRepository } from './load-posting.repository';
import { LoadPostingEntity } from './entities/load-posting.entity';
import { LoadPostingService } from './load-posting.service';
import {
  PICKER_BODIES,
  pickerWheelLabel,
  PickerBody,
  PickerWheel,
  TRUCK_TYPE_PICKER_ROWS,
} from '../../masters/vehicle/truck-type-picker.constants';
import { PostAddress, TruckPick } from './utils/load-posting.types';
import { driverUnavailableReason } from './utils/driver-availability';

/** How many recent postings of a customer are folded into past-load cards. */
const PAST_LOAD_SCAN_LIMIT = 200;
/** Recent-customers scans this many postings to find the last four distinct customers. */
const RECENT_SCAN_LIMIT = 100;
const FLEET_PICKER_LIMIT = 50;

/**
 * Read-side of the Post a load form: everything the pickers need before the shipper taps Post.
 * Masters are searched first (PL-09 note 1) — nothing here calls Google.
 */
export class LoadPostingLookupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: LoadPostingRepository,
    private readonly loadRepository: LoadRepository,
    private readonly customerService: CustomerService,
    private readonly vehicleService: VehicleService,
    private readonly postingService: LoadPostingService,
  ) {}

  /** PL-01 — the last N customers a load was raised for, most recent load first. A customer
   *  appears once, at the position of their latest load (Post a load or requisition). */
  async recentCustomers(tenantId: string, limit: number) {
    try {
      const activity = await this.repository.listCustomerActivity(tenantId, RECENT_SCAN_LIMIT);
      const lastLoadAt = new Map<string, Date>();
      for (const row of activity) {
        if (!lastLoadAt.has(row.customerId)) lastLoadAt.set(row.customerId, row.at);
      }
      const ids = [...lastLoadAt.keys()];
      const customers = await this.repository.findCustomers(tenantId, ids);
      // findCustomers drops deleted customers; keep the recency order for the rest.
      return ids
        .map((id) => customers.find((customer) => customer.id === id))
        .filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
        .slice(0, limit)
        .map((customer) => ({
          id: customer.id,
          code: customer.code,
          name: customer.name,
          lastLoadAt: lastLoadAt.get(customer.id),
        }));
    } catch (error) {
      rethrow(error, 'Failed to list recent customers');
    }
  }

  /** PL-02 — name or customer code, matched anywhere, ignoring case. */
  async searchCustomers(tenantId: string, search: string | undefined, limit: number) {
    try {
      const customers = await this.repository.searchCustomers(tenantId, search, limit);
      return customers.map(({ customer, unloadingPointCount }) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        status: customer.status,
        unloadingPointCount,
      }));
    } catch (error) {
      rethrow(error, 'Failed to search customers');
    }
  }

  /** PL-03/04 — add by typed name; an exact (case-insensitive) existing name is reused. */
  async quickAddCustomer(tenantId: string, actorId: string, role: string, name: string) {
    try {
      const existing = await this.repository.findCustomerByExactName(tenantId, name);
      const customer =
        existing ?? (await this.customerService.quickAdd(tenantId, actorId, role, name));
      return { id: customer.id, code: customer.code, name: customer.name, status: customer.status };
    } catch (error) {
      rethrow(error, 'Failed to add customer');
    }
  }

  /** PL-09/10 — this customer's saved unloading points. */
  async unloadingPoints(tenantId: string, customerId: string, search?: string) {
    try {
      const points = await this.repository.listUnloadingPoints(tenantId, customerId, search);
      return points.map((point) => ({
        id: point.id,
        label: point.location,
        addressLine1: point.addressLine1,
        city: point.city,
        state: point.state,
        pinCode: point.pinCode,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list unloading points');
    }
  }

  /** Pickup list; also the drop list when there is no customer ("your own saved locations"). */
  async loadingPoints(tenantId: string, search?: string) {
    try {
      const points = await this.repository.searchLoadingPoints(tenantId, search);
      return points.map((point) => ({
        id: point.id,
        label: point.title,
        addressLine1: point.addressLine1,
        city: point.city,
        state: point.state,
        pinCode: point.pinCode,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list loading points');
    }
  }

  async commodities(tenantId: string, search?: string) {
    try {
      const products = await this.repository.searchCommodities(tenantId, search);
      return products.map((product) => ({
        id: product.id,
        name: product.productDetails,
        packaging: product.packaging,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list commodities');
    }
  }

  /** PL-01 "Who gets it" — Loadsmart first, always included, then the tenant's active transporters. */
  async transporters(tenantId: string, search?: string) {
    try {
      const transporters = await this.repository.listActiveTransporters(tenantId, search);
      return {
        loadsmart: { alwaysIncluded: true, name: 'Loadsmart' },
        transporters: transporters.map((transporter) => ({
          id: transporter.id,
          name: transporter.name,
          phone: transporter.phone,
          city: transporter.city,
          state: transporter.state,
        })),
      };
    } catch (error) {
      rethrow(error, 'Failed to list transporters');
    }
  }

  /**
   * The truck-type picker's steps, from the fixed picker table (the one the Add Truck drawer uses),
   * not from the tenant's Truck master — so every tenant sees the full list. Each step only offers
   * what is left after the previous picks: body (open/closed), then tyres or axle, then tonnes,
   * then length (PL-09 note 3). The pick is matched to a Truck master row when the load is posted.
   */
  truckOptions(filters: { body?: PickerBody; wheel?: PickerWheel; capacityTons?: number }) {
    const byBody = TRUCK_TYPE_PICKER_ROWS.filter(
      (row) => !filters.body || row.body === filters.body,
    );
    const byWheel = byBody.filter(
      (row) => filters.wheel === undefined || row.wheel === filters.wheel,
    );
    const byTonnes = byWheel.filter(
      (row) => filters.capacityTons === undefined || row.capacityTons === filters.capacityTons,
    );
    const distinct = <T>(values: T[]) => [...new Set(values)];

    return {
      bodies: PICKER_BODIES.map((value) => ({
        value,
        label: value === 'open' ? 'Open' : 'Closed',
      })),
      // Only meaningful once a body is picked; before that every row would be mixed together.
      wheels: filters.body
        ? distinct(byBody.map((row) => row.wheel)).map((value) => ({
            value,
            label: pickerWheelLabel(value),
          }))
        : [],
      capacities:
        filters.body && filters.wheel !== undefined
          ? distinct(byWheel.map((row) => row.capacityTons)).sort((a, b) => a - b)
          : [],
      lengthsFt:
        filters.body && filters.wheel !== undefined && filters.capacityTons !== undefined
          ? distinct(byTonnes.flatMap((row) => [...row.bodyLengthsFt]))
          : [],
    };
  }

  /** PL-22 — only trucks that can take the load are listed: active (so not in the workshop,
   *  inactive or pending), not on a trip, and not on a live load. Expired papers hide a truck;
   *  papers expiring soon only add a warning. */
  async fleetOptions(tenantId: string, search?: string) {
    try {
      const { items } = await this.vehicleService.listVehicles(tenantId, {
        page: 1,
        limit: FLEET_PICKER_LIMIT,
        search,
      });
      const candidates = items.filter((v) => v.status === 'active');
      const active = candidates.length
        ? await this.loadRepository.findActiveByVehicles(
            tenantId,
            candidates.map((vehicle) => vehicle.id),
          )
        : [];
      const onLoad = new Set(active.map((load) => load.vehicleId));
      // An open maintenance visit means the truck is in the workshop, whatever its status says.
      const inWorkshop = await this.repository.listVehicleIdsInWorkshop(
        tenantId,
        candidates.map((vehicle) => vehicle.id),
      );
      const usable = candidates.filter((vehicle) => {
        const operational = vehicle.operationalStatus?.operationalStatus;
        return (
          !onLoad.has(vehicle.id) &&
          !inWorkshop.has(vehicle.id) &&
          operational !== 'on_trip' &&
          operational !== 'inactive'
        );
      });

      // The linked driver of each truck, with whether they can actually take a trip right now.
      const linkedDriverIds = [
        ...new Set(
          usable
            .map(
              (v) =>
                (v.driverLinks ?? []).find((l) => l.isPrimary && l.status === 'active')?.driverId,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const [relations, busyDrivers] = await Promise.all([
        this.repository.listDriverRelationsByDriverIds(tenantId, linkedDriverIds),
        this.repository.listDriverIdsOnActiveLoads(tenantId, linkedDriverIds),
      ]);

      const rows = await Promise.all(
        usable.map(async (vehicle) => {
          const detail = await this.vehicleService.getVehicle(tenantId, vehicle.id);
          const papers = this.postingService.paperStatus(detail.documents ?? []);
          // Expired papers make a truck ineligible — it is left out of the list entirely.
          if (papers.expired.length > 0) return null;
          const primary = (vehicle.driverLinks ?? []).find(
            (link) => link.isPrimary && link.status === 'active',
          );
          const relation = relations.find((r) => r.driverId === primary?.driverId);
          const reason = primary
            ? driverUnavailableReason(relation, busyDrivers.has(primary.driverId))
            : null;
          const linkedDriver = primary
            ? {
                id: primary.driverId,
                name: primary.driver?.fullName ?? null,
                phone: primary.driver?.phoneNumber ?? null,
                available: reason === null,
                unavailableReason: reason,
              }
            : null;
          return {
            id: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            truckType: vehicle.truckType?.name ?? null,
            capacityTons: vehicle.capacityTons,
            bodyLengthFt: vehicle.bodyLengthFt,
            driverName: primary?.driver?.fullName ?? null,
            driver: linkedDriver,
            // True when the shipper must pick a (different) idle driver before posting.
            needsDriverChoice: !linkedDriver || !linkedDriver.available,
            warnings: papers.expiringSoon.map((type) => `${type} expiring soon`),
          };
        }),
      );
      return rows.filter((row): row is NonNullable<typeof row> => row !== null);
    } catch (error) {
      rethrow(error, 'Failed to list own fleet');
    }
  }

  /** Idle drivers to choose from when a truck's own driver is missing or unavailable (PL-22):
   *  active in this fleet, not on leave or inactive, and not on a live load. */
  async availableDrivers(tenantId: string, search?: string) {
    try {
      const relations = await this.repository.listActiveDriverRelations(tenantId, search);
      const busy = await this.repository.listDriverIdsOnActiveLoads(
        tenantId,
        relations.map((relation) => relation.driverId),
      );
      return relations
        .filter(
          (relation) => driverUnavailableReason(relation, busy.has(relation.driverId)) === null,
        )
        .map((relation) => ({
          id: relation.driverId,
          name: relation.driver.fullName,
          phone: relation.driver.phoneNumber,
        }));
    } catch (error) {
      rethrow(error, 'Failed to list available drivers');
    }
  }

  /**
   * PL-06 — the customer's past loads grouped by lane (same pickup, drop and truck), highest
   * move count first. Each card carries what picking it fills; it never fills Deliver by or the
   * price (an old date or rate must not be reposted), and indent/own-fleet transporter and truck
   * are never carried over. `customerId` omitted = the "No customer" history.
   */
  async pastLoads(tenantId: string, customerId?: string) {
    try {
      if (customerId) {
        const [customer] = await this.repository.findCustomers(tenantId, [customerId]);
        if (!customer) throw new NotFoundError(`Customer ${customerId} not found`);
      }
      const postings = await this.repository.listRecentPostings(
        tenantId,
        customerId ?? null,
        PAST_LOAD_SCAN_LIMIT,
      );

      const lanes = new Map<string, { latest: LoadPostingEntity; moves: number }>();
      for (const posting of postings) {
        const key = [
          posting.pickupLoadingPointId ?? addressKey(posting.pickupAddress),
          posting.dropCustomerDeliveryPointId ??
            posting.dropLoadingPointId ??
            addressKey(posting.dropAddress),
          posting.truckPick ? truckPickLabel(posting.truckPick) : (posting.vehicleId ?? 'none'),
        ].join('|');
        const lane = lanes.get(key);
        if (lane) lane.moves += 1;
        else lanes.set(key, { latest: posting, moves: 1 }); // postings are newest first
      }

      const cards = await Promise.all(
        [...lanes.entries()].map(async ([key, { latest, moves }]) => {
          const recipients =
            latest.mode === 'market_fleet'
              ? await this.repository.listRecipients(tenantId, latest.id)
              : [];
          return {
            key,
            pickup: latest.pickupAddress.label,
            drop: latest.dropAddress.label,
            truck: latest.truckPick ? truckPickLabel(latest.truckPick) : null,
            commodity: latest.commodityName,
            moves,
            fill: {
              mode: latest.mode,
              transporterIds:
                latest.mode === 'market_fleet'
                  ? recipients.map((r) => r.transporterId).filter(Boolean)
                  : [],
              pickup: latest.pickupLoadingPointId
                ? { loadingPointId: latest.pickupLoadingPointId }
                : null,
              drop: latest.dropCustomerDeliveryPointId
                ? { customerDeliveryPointId: latest.dropCustomerDeliveryPointId }
                : latest.dropLoadingPointId
                  ? { loadingPointId: latest.dropLoadingPointId }
                  : null,
              commodity: latest.commodityId
                ? { productId: latest.commodityId }
                : { name: latest.commodityName },
              packaging: latest.packaging,
              weightTonnes: latest.weightTonnes,
              truckCount: latest.truckCount,
              truck: latest.mode === 'own_fleet' ? null : latest.truckPick,
              acceptedTrucks: latest.mode === 'own_fleet' ? [] : latest.acceptedTruckPicks,
              advancePercentage: latest.advancePercentage,
              balancePaidBy: latest.balancePaidBy,
              note: latest.note,
            },
          };
        }),
      );
      return cards.sort((a, b) => b.moves - a.moves);
    } catch (error) {
      rethrow(error, 'Failed to list past loads');
    }
  }

  async getPosting(tenantId: string, postingId: string) {
    try {
      const posting = await this.repository.findPostingById(tenantId, postingId);
      if (!posting) throw new NotFoundError(`Posting ${postingId} not found`);
      const [recipients, loads] = await Promise.all([
        this.repository.listRecipients(tenantId, postingId),
        this.repository.listLoadsByPosting(tenantId, postingId),
      ]);
      return { posting, recipients, loads: loads.map((l) => ({ id: l.id, code: l.code })) };
    } catch (error) {
      rethrow(error, 'Failed to fetch posting');
    }
  }
}

/** "Closed · MXL · 18T · 32ft" — card label and lane key for a stored picker choice. */
function truckPickLabel(pick: TruckPick): string {
  const wheel = pickerWheelLabel(pick.wheel as PickerWheel);
  return `${pick.body === 'open' ? 'Open' : 'Closed'} · ${wheel} · ${pick.capacityTons}T · ${pick.bodyLengthFt}ft`;
}

function addressKey(address: PostAddress): string {
  return `${address.label}|${address.pinCode ?? ''}`.toLowerCase();
}
