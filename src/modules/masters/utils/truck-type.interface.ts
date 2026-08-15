import { TruckTypeEntity } from '../entities/truck-type.entity';

export interface CreateTruckTypeInput {
  name: string;
}

export interface CreateTruckTypeData {
  tenantId: string;
  name: string;
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
