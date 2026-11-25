import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { GeofenceEntity } from './entities/geofence.entity';
import { GeofenceEventEntity } from './entities/geofence-event.entity';
import { GeofenceVehicleEntity } from './entities/geofence-vehicle.entity';
import { GeofenceRecipientEntity } from './entities/geofence-recipient.entity';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import { CustomerDeliveryPointEntity } from '../customers/entities/customer-delivery-point.entity';
import { GeofenceType } from './utils/geofence.types';
import {
  CreateGeofenceData,
  ListGeofencesInput,
  ReplaceChildren,
  UpdateGeofenceData,
} from './utils/geofence.interface';

const WITH_CHILDREN = { vehicles: true, recipients: true } as const;

export class GeofenceRepository {
  private readonly geofences: Repository<GeofenceEntity>;
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly loadingPoints: Repository<LoadingPointEntity>;
  private readonly deliveryPoints: Repository<CustomerDeliveryPointEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.geofences = dataSource.getRepository(GeofenceEntity);
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
    this.deliveryPoints = dataSource.getRepository(CustomerDeliveryPointEntity);
  }

  /** Create + children in one transaction. */
  async create(data: CreateGeofenceData, children: ReplaceChildren): Promise<GeofenceEntity> {
    const id = await this.dataSource.transaction(async (manager) => {
      const saved = await manager
        .getRepository(GeofenceEntity)
        .save(manager.getRepository(GeofenceEntity).create(data));
      await this.replaceChildren(manager, saved.id, children);
      return saved.id;
    });
    return (await this.findById(data.tenantId, id))!;
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateGeofenceData,
    children: ReplaceChildren,
  ): Promise<GeofenceEntity | null> {
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(data).length > 0) {
        await manager.getRepository(GeofenceEntity).update({ id, tenantId }, data);
      }
      await this.replaceChildren(manager, id, children);
    });
    return this.findById(tenantId, id);
  }

  private async replaceChildren(
    manager: EntityManager,
    geofenceId: string,
    children: ReplaceChildren,
  ): Promise<void> {
    if (children.vehicleIds) {
      const repo = manager.getRepository(GeofenceVehicleEntity);
      await repo.delete({ geofenceId });
      if (children.vehicleIds.length > 0) {
        await repo.insert(children.vehicleIds.map((vehicleId) => ({ geofenceId, vehicleId })));
      }
    }
    if (children.recipients) {
      const repo = manager.getRepository(GeofenceRecipientEntity);
      await repo.delete({ geofenceId });
      if (children.recipients.length > 0) {
        await repo.insert(children.recipients.map((recipient) => ({ geofenceId, ...recipient })));
      }
    }
  }

  findById(tenantId: string, id: string): Promise<GeofenceEntity | null> {
    return this.geofences.findOne({ where: { id, tenantId }, relations: WITH_CHILDREN });
  }

  /**
   * A load's pickup and drop master points — from its requisition, or from its posting for a
   * posted load. null when the load is not in this tenant.
   */
  async loadPoints(
    tenantId: string,
    loadId: string,
  ): Promise<{
    pickupLoadingPointId: string | null;
    dropCustomerDeliveryPointId: string | null;
    dropLoadingPointId: string | null;
  } | null> {
    const rows: Array<{
      pickup: string | null;
      drop_cdp: string | null;
      drop_lp: string | null;
    }> = await this.dataSource.query(
      `SELECT COALESCE(r.loading_point_id, p.pickup_loading_point_id) AS pickup,
              COALESCE(r.customer_delivery_point_id, p.drop_customer_delivery_point_id) AS drop_cdp,
              p.drop_loading_point_id AS drop_lp
       FROM loads.loads l
       LEFT JOIN loads.requisitions r ON r.id = l.requisition_id
       LEFT JOIN loads.load_postings p ON p.id = l.posting_id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [loadId, tenantId],
    );
    if (rows.length === 0) return null;
    return {
      pickupLoadingPointId: rows[0].pickup,
      dropCustomerDeliveryPointId: rows[0].drop_cdp,
      dropLoadingPointId: rows[0].drop_lp,
    };
  }

  /**
   * A trip created from the tracking screen (the tracking service's tracking.trips — same
   * database), for its geofences: each end is a master place — a loading point or a customer
   * delivery point, whose geofence the geofence syncs keep. (Trips saved before that rule may
   * have an end typed as an address: no master, so no geofence.) Null when there is no such
   * trip.
   */
  async trackingTripPoints(
    tenantId: string,
    tripId: string,
  ): Promise<{
    pickupLoadingPointId: string | null;
    pickupCustomerDeliveryPointId: string | null;
    dropCustomerDeliveryPointId: string | null;
    dropLoadingPointId: string | null;
  } | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select([
        't.origin_kind AS origin_kind',
        't.origin_ref_id AS origin_ref_id',
        't.destination_kind AS destination_kind',
        't.destination_ref_id AS destination_ref_id',
      ])
      .from('tracking.trips', 't')
      .where('t.id = :tripId AND t.tenant_id = :tenantId', { tripId, tenantId })
      .getRawOne<{
        origin_kind: string;
        origin_ref_id: string | null;
        destination_kind: string;
        destination_ref_id: string | null;
      }>();
    if (!row) return null;
    const ref = (kind: string, id: string | null, wanted: string) => (kind === wanted ? id : null);
    return {
      pickupLoadingPointId: ref(row.origin_kind, row.origin_ref_id, 'loading_point'),
      pickupCustomerDeliveryPointId: ref(row.origin_kind, row.origin_ref_id, 'customer_address'),
      dropCustomerDeliveryPointId: ref(
        row.destination_kind,
        row.destination_ref_id,
        'customer_address',
      ),
      dropLoadingPointId: ref(row.destination_kind, row.destination_ref_id, 'loading_point'),
    };
  }

  /** A load's geofence entered / left log, oldest first, with each geofence's name and type
   *  (deleted geofences included, so an old visit keeps its name). */
  eventsForLoad(
    tenantId: string,
    loadId: string,
  ): Promise<
    Array<{
      geofenceId: string;
      name: string | null;
      type: GeofenceType | null;
      event: 'enter' | 'exit';
      occurredAt: Date;
      latitude: string;
      longitude: string;
    }>
  > {
    return this.dataSource
      .getRepository(GeofenceEventEntity)
      .createQueryBuilder('e')
      .leftJoin(GeofenceEntity, 'g', 'g.id = e.geofenceId')
      .withDeleted()
      .select('e.geofenceId', 'geofenceId')
      .addSelect('g.name', 'name')
      .addSelect('g.type', 'type')
      .addSelect('e.event', 'event')
      .addSelect('e.occurredAt', 'occurredAt')
      .addSelect('e.latitude', 'latitude')
      .addSelect('e.longitude', 'longitude')
      .where('e.tenantId = :tenantId', { tenantId })
      .andWhere('e.loadId = :loadId', { loadId })
      .orderBy('e.occurredAt', 'ASC')
      .limit(500)
      .getRawMany();
  }

  /** The tenant's active geofences linked to any of these master points. */
  async findLinked(
    tenantId: string,
    loadingPointIds: string[],
    deliveryPointIds: string[],
  ): Promise<GeofenceEntity[]> {
    if (loadingPointIds.length === 0 && deliveryPointIds.length === 0) return [];
    const where: Array<Record<string, unknown>> = [];
    if (loadingPointIds.length > 0) {
      where.push({ tenantId, isActive: true, loadingPointId: In(loadingPointIds) });
    }
    if (deliveryPointIds.length > 0) {
      where.push({ tenantId, isActive: true, customerDeliveryPointId: In(deliveryPointIds) });
    }
    return this.geofences.find({ where });
  }

  /** The geofences standing for a customer's delivery points, deleted points included
   *  (CustomerDeliveryPointGeofenceSync). */
  findByCustomerId(tenantId: string, customerId: string): Promise<GeofenceEntity[]> {
    return this.geofences
      .createQueryBuilder('g')
      .innerJoin(CustomerDeliveryPointEntity, 'p', 'p.id = g.customerDeliveryPointId')
      .where('g.tenantId = :tenantId', { tenantId })
      .andWhere('p.customerId = :customerId', { customerId })
      .getMany();
  }

  /** The geofence standing for a master loading point (LoadingPointGeofenceSync). */
  findByLoadingPointId(tenantId: string, loadingPointId: string): Promise<GeofenceEntity | null> {
    return this.geofences.findOne({ where: { tenantId, loadingPointId } });
  }

  async list(tenantId: string, input: ListGeofencesInput): Promise<[GeofenceEntity[], number]> {
    const qb = this.geofences
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.vehicles', 'v')
      .leftJoinAndSelect('g.recipients', 'r')
      .where('g.tenantId = :tenantId', { tenantId });
    if (input.type) qb.andWhere('g.type = :type', { type: input.type });
    if (input.isActive !== undefined)
      qb.andWhere('g.isActive = :active', { active: input.isActive });
    if (input.search) {
      qb.andWhere('(g.name ILIKE :search OR g.address ILIKE :search)', {
        search: `%${input.search}%`,
      });
    }
    return qb
      .orderBy('g.createdAt', 'DESC')
      .skip((input.page - 1) * input.limit)
      .take(input.limit)
      .getManyAndCount();
  }

  /** The tenant's active geofences of these types, without children (LS_N_0027's halt check). */
  listActiveByTypes(tenantId: string, types: readonly GeofenceType[]): Promise<GeofenceEntity[]> {
    if (types.length === 0) return Promise.resolve([]);
    return this.geofences.find({ where: { tenantId, isActive: true, type: In([...types]) } });
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.geofences.softDelete({ id, tenantId });
    return result.affected === 1;
  }

  // --- Reference checks (tenant-scoped existence) ---

  async findExistingVehicleIds(tenantId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.vehicles.find({
      select: { id: true },
      where: { tenantId, id: In(ids) },
    });
    return new Set(rows.map((row) => row.id));
  }

  async findVehicleNumber(tenantId: string, vehicleId: string): Promise<string | null> {
    const vehicle = await this.vehicles.findOne({
      select: { id: true, registrationNumber: true },
      where: { tenantId, id: vehicleId },
    });
    return vehicle?.registrationNumber ?? null;
  }

  loadingPointExists(tenantId: string, id: string): Promise<boolean> {
    return this.loadingPoints.existsBy({ tenantId, id });
  }

  deliveryPointExists(tenantId: string, id: string): Promise<boolean> {
    return this.deliveryPoints.existsBy({ tenantId, id });
  }
}
