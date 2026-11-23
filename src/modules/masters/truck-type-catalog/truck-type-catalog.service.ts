import { rethrow } from '../../../shared/errors';
import { TruckTypeCatalogEntity } from './entities/truck-type-catalog.entity';
import { TruckTypeCatalogRepository } from './truck-type-catalog.repository';
import {
  TruckTypeCatalogConfiguration,
  TRUCK_TYPE_CATALOG_CONFIGURATIONS,
} from './truck-type-catalog-configurations.constants';

/** A catalog row plus the picker step values it stands for (family, body, tyres/axle, feet). */
export type TruckTypeCatalogListItem = TruckTypeCatalogEntity &
  Pick<TruckTypeCatalogConfiguration, 'family' | 'body' | 'wheel' | 'bodyLengthFt'>;

const CONFIGURATION_BY_NAME = new Map(
  TRUCK_TYPE_CATALOG_CONFIGURATIONS.map((config) => [config.name, config]),
);

export class TruckTypeCatalogService {
  constructor(private readonly truckTypeCatalogRepository: TruckTypeCatalogRepository) {}

  /** Active catalog rows that match the current picker table, each with its picker values. */
  async listCatalog(): Promise<TruckTypeCatalogListItem[]> {
    try {
      const rows = await this.truckTypeCatalogRepository.list();
      return rows.flatMap((row) => {
        const config = CONFIGURATION_BY_NAME.get(row.name);
        if (!config) return [];
        const { family, body, wheel, bodyLengthFt } = config;
        return [{ ...row, family, body, wheel, bodyLengthFt }];
      });
    } catch (error) {
      rethrow(error, 'Failed to list truck type catalog');
    }
  }

  /** Called by db/seed.ts — platform-side only. Idempotent by name, so re-running only adds
   *  what's missing. Retiring old names is the ReplaceTruckTypeCatalog migration's job. */
  async seedDefaults(actorId: string | null): Promise<void> {
    try {
      await this.truckTypeCatalogRepository.seedMissingConfigurations(
        TRUCK_TYPE_CATALOG_CONFIGURATIONS,
        actorId,
      );
    } catch (error) {
      rethrow(error, 'Failed to seed truck type catalog');
    }
  }
}
