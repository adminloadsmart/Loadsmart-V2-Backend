import { DataSource, IsNull, Repository } from 'typeorm';
import { TruckTypeCatalogEntity } from './entities/truck-type-catalog.entity';

export class TruckTypeCatalogRepository {
  private readonly catalog: Repository<TruckTypeCatalogEntity>;

  constructor(dataSource: DataSource) {
    this.catalog = dataSource.getRepository(TruckTypeCatalogEntity);
  }

  list(): Promise<TruckTypeCatalogEntity[]> {
    return this.catalog.find({ where: { deletedAt: IsNull() }, order: { name: 'ASC' } });
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
}
