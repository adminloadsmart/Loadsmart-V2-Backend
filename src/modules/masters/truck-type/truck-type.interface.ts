import { TruckTypeEntity } from './entities/truck-type.entity';
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

/** Market Fleet's 3-step picker (body type → wheel configuration → capacity) — resolves straight
 *  to a usable truckTypeId, get-or-create against the tenant's own list (truck-type.service.ts's
 *  resolveFromCatalog). */
export interface ResolveTruckTypeInput {
  bodyType: TruckBodyType;
  wheelConfiguration: number;
  capacityTons: number;
}

/* Route parameter shapes, used to type `Request<P>` in the controller. */

export type TruckTypeParams = { truckTypeId: string };
