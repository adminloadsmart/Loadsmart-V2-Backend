import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { GeofenceEntity } from './entities/geofence.entity';
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
