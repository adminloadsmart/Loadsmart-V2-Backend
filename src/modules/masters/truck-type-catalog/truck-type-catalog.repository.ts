import { DataSource, IsNull, Repository } from 'typeorm';
import { TruckTypeCatalogEntity } from './entities/truck-type-catalog.entity';
import { TruckTypeCatalogConfiguration } from './truck-type-catalog-configurations.constants';

export class TruckTypeCatalogRepository {
  private readonly catalog: Repository<TruckTypeCatalogEntity>;

  constructor(dataSource: DataSource) {
    this.catalog = dataSource.getRepository(TruckTypeCatalogEntity);
  }

  list(): Promise<TruckTypeCatalogEntity[]> {
    return this.catalog.find({ where: { deletedAt: IsNull() }, order: { name: 'ASC' } });
  }

  /** Idempotent by name: inserts only the configurations not already in the catalog. */
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
        deckVolumeCubicMeters: null,
        createdBy: actorId,
        deletedAt: null,
      }),
    );
    await this.catalog.save(rows);
  }
}
