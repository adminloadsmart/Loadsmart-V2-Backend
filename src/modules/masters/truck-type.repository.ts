import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
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

    return truckTypes.map((truckType) => {
      const { vehicles, ...rest } = truckType;
      return {
        ...rest,
        vehicleCount: vehicles.filter((vehicle) => !vehicle.deletedAt).length,
      };
    });
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

  /**
   * Inserts whichever of `names` the tenant doesn't already have (by name, active rows only) —
   * backs TruckTypeService.addFromCatalog ("Add truck type" modal: org_admin picks names off the
   * global catalog). Safe to call repeatedly without duplicating rows or clobbering an existing one.
   */
  async seedMissing(
    tenantId: string,
    names: readonly string[],
    actorId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const truckTypes = manager ? manager.getRepository(TruckTypeEntity) : this.truckTypes;
    const existing = await truckTypes.find({ where: { tenantId, deletedAt: IsNull() } });
    const existingNames = new Set(existing.map((truckType) => truckType.name));
    const missing = names.filter((name) => !existingNames.has(name));
    if (missing.length === 0) return;

    const rows = missing.map((name) =>
      truckTypes.create({ tenantId, name, createdBy: actorId, deletedAt: null }),
    );
    await truckTypes.save(rows);
  }
}
