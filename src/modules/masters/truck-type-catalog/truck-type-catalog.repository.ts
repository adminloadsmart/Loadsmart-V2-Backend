import { DataSource, IsNull, Repository } from 'typeorm';
import { TruckTypeCatalogEntity } from './entities/truck-type-catalog.entity';
import { TruckTypeCatalogConfiguration } from './truck-type-catalog-configurations.constants';
import { TruckBodyType } from '../truck-type/truck-type.types';

export class TruckTypeCatalogRepository {
  private readonly catalog: Repository<TruckTypeCatalogEntity>;

  constructor(dataSource: DataSource) {
    this.catalog = dataSource.getRepository(TruckTypeCatalogEntity);
  }

  list(): Promise<TruckTypeCatalogEntity[]> {
    return this.catalog.find({ where: { deletedAt: IsNull() }, order: { name: 'ASC' } });
  }

  /** Resolves the Market Fleet 3-step picker's exact body/wheel/capacity selection to one catalog
   *  entry — backs TruckTypeService.resolveFromCatalog's get-or-create. */
  findByAttributes(
    bodyType: TruckBodyType,
    wheelConfiguration: number,
    capacityTons: number,
  ): Promise<TruckTypeCatalogEntity | null> {
    return this.catalog.findOneBy({
      bodyType,
      wheelConfiguration,
      capacityTons: String(capacityTons),
      deletedAt: IsNull(),
    });
  }

  /** Same idempotent shape as truck-type.repository.ts's seedMissing, one level up (global, no tenant). */
  async seedMissing(names: readonly string[], actorId: string | null): Promise<void> {
    const existing = await this.list();
    const existingNames = new Set(existing.map((entry) => entry.name));
    const missing = names.filter((name) => !existingNames.has(name));
    if (missing.length === 0) return;

    const rows = missing.map((name) =>
      this.catalog.create({ name, createdBy: actorId, deletedAt: null }),
    );
    await this.catalog.save(rows);
  }

  /** Same idempotent-by-name shape as seedMissing, but carrying the structured body/wheel/capacity
   *  fields (Plan Dispatch v2.0 §6.6's Market Fleet picker) rather than just a name. */
  async seedMissingConfigurations(
    configurations: readonly TruckTypeCatalogConfiguration[],
    actorId: string | null,
  ): Promise<void> {
    const existing = await this.list();
    const existingNames = new Set(existing.map((entry) => entry.name));
    const missing = configurations.filter((config) => !existingNames.has(config.name));
    if (missing.length === 0) return;

    const rows = missing.map((config) =>
      this.catalog.create({
        name: config.name,
        bodyType: config.bodyType,
        wheelConfiguration: config.wheelConfiguration,
        capacityTons: String(config.capacityTons),
        deckVolumeCubicMeters: String(config.deckVolumeCubicMeters),
        createdBy: actorId,
        deletedAt: null,
      }),
    );
    await this.catalog.save(rows);
  }
}
