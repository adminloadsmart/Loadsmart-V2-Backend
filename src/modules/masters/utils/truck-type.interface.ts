import { TruckTypeEntity } from '../entities/truck-type.entity';
import { TruckBodyType } from './truck-type.types';

export interface CreateTruckTypeInput {
  name: string;
  bodyType: TruckBodyType;
  wheelConfiguration: number;
  capacityTons: number;
  deckVolumeCubicMeters: number;
}

export interface CreateTruckTypeData {
  tenantId: string;
  name: string;
  bodyType?: TruckBodyType | null;
  wheelConfiguration?: number | null;
  capacityTons?: string | null;
  deckVolumeCubicMeters?: string | null;
  createdBy: string | null;
}

/** The list view — each row plus how many vehicles currently reference it (truck-type.service.ts's delete guard). The `vehicles` relation itself is dropped; only the count is exposed. */
export type TruckTypeWithVehicleCount = Omit<TruckTypeEntity, 'vehicles'> & {
  vehicleCount: number;
};

/** "Add truck type" modal: org_admin picks names off the global catalog to add to their own list. */
export interface AddTruckTypesFromCatalogInput {
  names: string[];
}
