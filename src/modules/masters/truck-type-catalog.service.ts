import { rethrow } from '../../shared/errors';
import { TruckTypeCatalogEntity } from './entities/truck-type-catalog.entity';
import { TruckTypeCatalogRepository } from './truck-type-catalog.repository';
import { DEFAULT_TRUCK_TYPES } from './utils/truck-type.constants';
import { TRUCK_TYPE_CATALOG_CONFIGURATIONS } from './utils/truck-type-catalog-configurations.constants';

export class TruckTypeCatalogService {
  constructor(private readonly truckTypeCatalogRepository: TruckTypeCatalogRepository) {}

  async listCatalog(): Promise<TruckTypeCatalogEntity[]> {
    try {
      return await this.truckTypeCatalogRepository.list();
    } catch (error) {
      rethrow(error, 'Failed to list truck type catalog');
    }
  }

  /** Called once by db/seed.ts — platform-side only, not exposed over the API yet. Seeds both the
   *  legacy name-only entries and the structured body/wheel/capacity catalog (Plan Dispatch v2.0
   *  §6.6's Market Fleet picker) — each idempotent by name, so re-running only adds what's missing. */
  async seedDefaults(actorId: string | null): Promise<void> {
    try {
      await this.truckTypeCatalogRepository.seedMissing(DEFAULT_TRUCK_TYPES, actorId);
      await this.truckTypeCatalogRepository.seedMissingConfigurations(
        TRUCK_TYPE_CATALOG_CONFIGURATIONS,
        actorId,
      );
    } catch (error) {
      rethrow(error, 'Failed to seed truck type catalog');
    }
  }
}
