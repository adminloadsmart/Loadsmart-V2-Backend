import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { TyreEntity } from '../entities/tyre.entity';
import { TyreReadingEntity } from '../entities/tyre-reading.entity';
import { MAINTAINED_VEHICLE_STATUSES, OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance.types';

export type CreateTyreData = Omit<
  TyreEntity,
  | 'id'
  | 'vehicle'
  | 'readings'
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
    'status' | 'removedAt' | 'removedOdometerKm' | 'removedReason' | 'casingCondition' | 'updatedBy'
  >
>;
export type CreateTyreReadingData = Omit<TyreReadingEntity, 'id' | 'tyre' | 'createdAt'>;

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

  findFittedAt(tenantId: string, vehicleId: string, position: string): Promise<TyreEntity | null> {
    return this.tyres.findOneBy({ tenantId, vehicleId, position, status: 'fitted' });
  }

  async update(tenantId: string, id: string, data: UpdateTyreData): Promise<TyreEntity | null> {
    await this.tyres.update({ id, tenantId }, data);
    return this.findById(tenantId, id);
  }

  createReading(data: CreateTyreReadingData): Promise<TyreReadingEntity> {
    return this.readings.save(this.readings.create(data));
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
      relations: { vehicle: { serviceUsage: true } },
    });
  }

  /** Latest gauge reading per tyre (DISTINCT ON), keyed by tyre id. */
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
