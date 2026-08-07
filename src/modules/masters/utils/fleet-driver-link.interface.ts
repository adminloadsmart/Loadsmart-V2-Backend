import { FleetDriverLinkStatus } from './fleet-driver-link.type';

/* Service-layer inputs — shapes accepted from the controller. */

export interface LinkDriverInput {
  driverId: string;
  isPrimary?: boolean;
  linkedFrom?: string;
}

/* Repository-layer data — shapes written to the database. */

export interface CreateFleetDriverLinkData {
  tenantId: string;
  vehicleId: string;
  driverId: string;
  isPrimary: boolean;
  linkedFrom: string;
  createdBy: string | null;
}

export interface UpdateFleetDriverLinkData {
  isPrimary?: boolean;
  linkedTo?: string | null;
  status?: FleetDriverLinkStatus;
  updatedBy?: string | null;
}
