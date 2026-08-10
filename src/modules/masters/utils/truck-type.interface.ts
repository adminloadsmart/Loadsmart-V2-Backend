import { TruckTypeEntity } from '../entities/truck-type.entity';

export interface CreateTruckTypeInput {
  name: string;
}

export interface CreateTruckTypeData {
  tenantId: string;
  name: string;
  createdBy: string | null;
}

/** The list view — each row plus how many vehicles currently reference it (truck-type.service.ts's delete guard). */
export type TruckTypeWithVehicleCount = TruckTypeEntity & { vehicleCount: number };
