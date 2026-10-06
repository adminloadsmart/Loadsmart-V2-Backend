import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { TyreEntity } from '../entities/tyre.entity';
import { TyreReadingEntity } from '../entities/tyre-reading.entity';
import { MAINTAINED_VEHICLE_STATUSES, OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance.types';

export type CreateTyreData = Omit<
  TyreEntity,
  | 'id'
  | 'vehicle'
  | 'readings'
  | 'maintenanceJob'
  | 'status'
  | 'removedAt'
  | 'removedOdometerKm'
  | 'removedReason'
  | 'createdAt'
  | 'updatedAt'
  | 'updatedBy'
>;
export type UpdateTyreData = Partial<
  Pick<
    TyreEntity,
    | 'status'
    | 'removedAt'
    | 'removedOdometerKm'
    | 'removedReason'
    | 'casingCondition'
    | 'brand'
    | 'fittedAt'
    | 'serialNumber'
    | 'sizeCode'
    | 'updatedBy'
  >
>;
export type CreateTyreReadingData = Omit<
  TyreReadingEntity,
  'id' | 'tyre' | 'createdAt' | 'isEstimated'
> & { isEstimated?: boolean };

export class TyreRepository {
  private readonly tyres: Repository<TyreEntity>;
  private readonly readings: Repository<TyreReadingEntity>;

  constructor(dataSource: DataSource) {
    this.tyres = dataSource.getRepository(TyreEntity);
    this.readings = dataSource.getRepository(TyreReadingEntity);
  }

  create(data: CreateTyreData, manager?: EntityManager): Promise<TyreEntity> {
    const repo = manager?.getRepository(TyreEntity) ?? this.tyres;
    return repo.save(repo.create(data));
  }

  findById(tenantId: string, id: string): Promise<TyreEntity | null> {
    return this.tyres.findOne({
      where: { id, tenantId },
      relations: { vehicle: { serviceUsage: true } },
    });
  }

  findFittedAt(
    tenantId: string,
    vehicleId: string,
    position: string,
    manager?: EntityManager,
  ): Promise<TyreEntity | null> {
    const repo = manager?.getRepository(TyreEntity) ?? this.tyres;
    return repo.findOneBy({ tenantId, vehicleId, position, status: 'fitted' });
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateTyreData,
    manager?: EntityManager,
  ): Promise<TyreEntity | null> {
    if (manager) {
      await manager.getRepository(TyreEntity).update({ id, tenantId }, data);
      return manager.getRepository(TyreEntity).findOneBy({ id, tenantId });
    }
    await this.tyres.update({ id, tenantId }, data);
    return this.findById(tenantId, id);
  }

  /** Every tyre fitted to one truck right now — the axle diagram. */
  listFittedForVehicle(
    tenantId: string,
    vehicleId: string,
    manager?: EntityManager,
  ): Promise<TyreEntity[]> {
    const repo = manager?.getRepository(TyreEntity) ?? this.tyres;
    return repo.find({
      where: { tenantId, vehicleId, status: 'fitted' },
      order: { position: 'ASC' },
    });
  }

  /** Fitted tyres across several trucks in one query, with each truck's odometer for the wear maths. */
  listFittedForVehicles(tenantId: string, vehicleIds: string[]): Promise<TyreEntity[]> {
    if (vehicleIds.length === 0) return Promise.resolve([]);
    return this.tyres.find({
      where: { tenantId, vehicleId: In(vehicleIds), status: 'fitted' },
      relations: { vehicle: { serviceUsage: true } },
      order: { position: 'ASC' },
    });
  }

  /**
   * A truck's first odometer reading becomes the start point for the tyres fitted before it had
   * one (onboarding stores those at 0 km with readings at no km) — without this, every km on the
   * clock would count as worn since fitment. Returns how many tyres were rebased.
   */
  async rebaseUnmeteredTyres(
    tenantId: string,
    vehicleId: string,
    odometerKm: number,
    manager: EntityManager,
  ): Promise<number> {
    const tyres = await manager.getRepository(TyreEntity).find({
      select: { id: true },
      where: { tenantId, vehicleId, status: 'fitted', fittedOdometerKm: 0 },
    });
    if (tyres.length === 0) return 0;

    const tyreIds = tyres.map((tyre) => tyre.id);
    await manager
      .getRepository(TyreEntity)
      .update({ tenantId, id: In(tyreIds) }, { fittedOdometerKm: odometerKm });
    await manager
      .getRepository(TyreReadingEntity)
      .update({ tenantId, tyreId: In(tyreIds), odometerKm: IsNull() }, { odometerKm });
    return tyreIds.length;
  }

  createReading(data: CreateTyreReadingData, manager?: EntityManager): Promise<TyreReadingEntity> {
    const repo = manager?.getRepository(TyreReadingEntity) ?? this.readings;
    return repo.save(repo.create(data));
  }

  /** Every tyre currently fitted to a running own-fleet truck. */
  listFitted(tenantId: string): Promise<TyreEntity[]> {
    return this.tyres.find({
      where: {
        tenantId,
        status: 'fitted',
        vehicle: {
          ownershipType: In([...OWN_FLEET_OWNERSHIP_TYPES]),
          status: In([...MAINTAINED_VEHICLE_STATUSES]),
          deletedAt: IsNull(),
        },
      },
      relations: { vehicle: { serviceUsage: true, truckType: true } },
    });
  }

  /** Latest gauge reading per tyre (DISTINCT ON), keyed by tyre id. */
  /** The first reading on record for a tyre — a corrected fitted date can't be later than this. */
  async earliestReadingDate(
    tenantId: string,
    tyreId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const repo = manager?.getRepository(TyreReadingEntity) ?? this.readings;
    const first = await repo.findOne({
      where: { tenantId, tyreId },
      order: { readingDate: 'ASC' },
    });
    return first?.readingDate ?? null;
  }

  async latestReadings(
    tenantId: string,
    tyreIds: string[],
  ): Promise<Map<string, TyreReadingEntity>> {
    if (tyreIds.length === 0) return new Map();

    const rows = await this.readings
      .createQueryBuilder('reading')
      .distinctOn(['reading.tyre_id'])
      .where('reading.tenant_id = :tenantId', { tenantId })
      .andWhere('reading.tyre_id IN (:...tyreIds)', { tyreIds })
      .orderBy('reading.tyre_id')
      .addOrderBy('reading.reading_date', 'DESC')
      .addOrderBy('reading.created_at', 'DESC')
      .getMany();

    return new Map(rows.map((row) => [row.tyreId, row]));
  }
}
