import { PaginationInput } from '../../masters/utils/masters.types';
import { FreightType, LoadSourceType, LoadStatus, ManualTrackingStatus } from './loads.types';

/** Fields vary by the load's existing `sourceType` — the service validates which are required
 *  (own-fleet: vehicleId required, driverId optional/defaulted; market: transporterId + freight
 *  terms required, vehicleNumber/driverNumber free text), not the shape itself. */
export interface AssignLoadInput {
  vehicleId?: string;
  driverId?: string;
  vehicleNumber?: string;
  driverNumber?: string;
  transporterId?: string;
  freightType?: FreightType;
  freightValue?: number;
  advancePercentage?: number;
  balancePercentage?: number;
}

export interface ConfirmLoadingInput {
  invoiceNumber: string;
  invoiceFileKey: string;
  ewayBillNumber: string;
  ewayBillFileKey: string;
  elrNumber?: string;
  elrFileKey: string;
}

export interface UpdateLoadStatusInput {
  toStatus: ManualTrackingStatus;
}

/** Exactly one of {podFileKey} or {podReceiverName + podQuantityReceived} — enforced by the
 *  validator's `.refine` and re-checked in the service. */
export interface UploadPodInput {
  podFileKey?: string;
  podReceiverName?: string;
  podQuantityReceived?: number;
  podRemarks?: string;
}

export interface ListLoadsInput extends PaginationInput {
  requisitionId?: string;
  status?: LoadStatus;
  sourceType?: LoadSourceType;
  transporterId?: string;
  vehicleId?: string;
}

export type LoadParams = { loadId: string };

export interface EwayBillExpiry {
  expiresAt: string | null;
  expired: boolean;
}
