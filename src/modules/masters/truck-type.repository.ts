import { DataSource, IsNull, Repository } from 'typeorm';
import { TruckTypeEntity } from './entities/truck-type.entity';
import { CreateTruckTypeData, TruckTypeWithVehicleCount } from './utils/truck-type.interface';

export class TruckTypeRepository {
  private readonly truckTypes: Repository<TruckTypeEntity>;

  constructor(dataSource: DataSource) {
    this.truckTypes = dataSource.getRepository(TruckTypeEntity);
  }

  async create(data: CreateTruckTypeData): Promise<TruckTypeEntity> {
    const truckType = this.truckTypes.create({ ...data, deletedAt: null });
    return this.truckTypes.save(truckType);
  }

  findById(tenantId: string, id: string): Promise<TruckTypeEntity | null> {
    return this.truckTypes.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findByName(tenantId: string, name: string): Promise<TruckTypeEntity | null> {
    return this.truckTypes.findOneBy({ tenantId, name, deletedAt: IsNull() });
  }

  /**
   * Backs the "IN FLEET" column and its delete guard. Loads the `vehicles` relation the same
   * way every other repository in this module loads relations (plain `find`, no query builder)
   * and counts in memory — this list is per-tenant admin settings data (tens of rows), not a
   * hot path, so the simple/consistent approach wins over a hand-written aggregate query.
   */
  async list(tenantId: string): Promise<TruckTypeWithVehicleCount[]> {
    const truckTypes = await this.truckTypes.find({
      where: { tenantId, deletedAt: IsNull() },
      relations: { vehicles: true },
      order: { name: 'ASC' },
    });

    return truckTypes.map((truckType) => ({
      ...truckType,
      vehicleCount: truckType.vehicles.filter((vehicle) => !vehicle.deletedAt).length,
    }));
  }

  /** Single-row version of the `vehicleCount` in `list()`, used by the delete guard. */
  async countVehicles(tenantId: string, id: string): Promise<number> {
    const truckType = await this.truckTypes.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { vehicles: true },
    });
    return truckType ? truckType.vehicles.filter((vehicle) => !vehicle.deletedAt).length : 0;
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.truckTypes.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }
}
