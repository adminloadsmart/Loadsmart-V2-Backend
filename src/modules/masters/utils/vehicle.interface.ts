import { PaginationInput } from './masters.types';
import {
  VehicleBodyType,
  VehicleDocumentStatus,
  VehicleDocumentType,
  VehicleFuelType,
  VehicleOperationalStatus,
  VehicleOwnershipType,
  VehicleStatus,
  VehicleVerificationStatus,
  VehicleVerificationType,
} from './vehicle.type';

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateVehicleInput {
  registrationNumber: string;
  truckTypeId?: string;
  fuelType?: VehicleFuelType;
  bodyType?: VehicleBodyType;
  wheelCount?: number;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
}

export interface UpdateVehicleInput {
  truckTypeId?: string;
  fuelType?: VehicleFuelType;
  bodyType?: VehicleBodyType;
  wheelCount?: number;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
  status?: VehicleStatus;
}

export interface ListVehiclesInput extends PaginationInput {
  status?: VehicleStatus;
  operationalStatus?: VehicleOperationalStatus;
  search?: string;
}

/** Raw `req.query` shape for the list endpoint — normalized into `ListVehiclesInput` by the service. */
export interface ListVehiclesQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  status?: string;
  operationalStatus?: string;
}

export interface AddVehicleDocumentInput {
  documentType: VehicleDocumentType;
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  fileUrl?: string;
}

export interface UpdateVehicleDocumentInput {
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  fileUrl?: string;
}

/* Repository-layer data — shapes written to the database. */

export interface CreateVehicleData {
  tenantId: string;
  registrationNumber: string;
  truckTypeId: string | null;
  fuelType: VehicleFuelType | null;
  bodyType: VehicleBodyType | null;
  wheelCount: number | null;
  capacityTons: string | null;
  ownershipType: VehicleOwnershipType;
  createdBy: string | null;
}

export interface UpdateVehicleData {
  truckTypeId?: string | null;
  fuelType?: VehicleFuelType | null;
  bodyType?: VehicleBodyType | null;
  wheelCount?: number | null;
  capacityTons?: string | null;
  ownershipType?: VehicleOwnershipType;
  status?: VehicleStatus;
  updatedBy?: string | null;
}

export interface ListVehiclesFilters {
  status?: VehicleStatus;
  operationalStatus?: VehicleOperationalStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface CreateVehicleDocumentData {
  tenantId: string;
  vehicleId: string;
  documentType: VehicleDocumentType;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileUrl: string | null;
  status: VehicleDocumentStatus;
  createdBy: string | null;
}

export interface UpdateVehicleDocumentData {
  documentNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  fileUrl?: string | null;
  status?: VehicleDocumentStatus;
  updatedBy?: string | null;
}

/* Operational status — one current row per vehicle. */

export interface SetVehicleOperationalStatusInput {
  operationalStatus: VehicleOperationalStatus;
  reason?: string;
  effectiveAt?: string;
}

export interface CreateVehicleOperationalStatusData {
  tenantId: string;
  vehicleId: string;
  operationalStatus: VehicleOperationalStatus;
  reason: string | null;
  effectiveAt: Date;
  createdBy: string | null;
}

export interface UpdateVehicleOperationalStatusData {
  operationalStatus?: VehicleOperationalStatus;
  reason?: string | null;
  effectiveAt?: Date;
  updatedBy?: string | null;
}

/* Telemetry metadata — one row per vehicle. */

export interface SetVehicleTelemetryMetaInput {
  gpsProvider?: string;
  gpsEnabled?: boolean;
  emiAmount?: number;
  emiEndDate?: string;
}

export interface CreateVehicleTelemetryMetaData {
  tenantId: string;
  vehicleId: string;
  gpsProvider: string | null;
  gpsEnabled: boolean;
  emiAmount: string | null;
  emiEndDate: string | null;
  createdBy: string | null;
}

export interface UpdateVehicleTelemetryMetaData {
  gpsProvider?: string | null;
  gpsEnabled?: boolean;
  emiAmount?: string | null;
  emiEndDate?: string | null;
  updatedBy?: string | null;
}

/* Verification snapshots — append-only history per vehicle. */

/** Paper expiry dates the registry returns; recording a verification writes these into documents. */
export interface VehicleVerificationPapersInput {
  insuranceValidTo?: string;
  rcValidTo?: string;
  permitValidTo?: string;
  pucValidTo?: string;
  fitnessValidTo?: string;
}

export interface RecordVehicleVerificationInput {
  verificationType: VehicleVerificationType;
  verificationStatus: VehicleVerificationStatus;
  sourceReference?: string;
  registeredName?: string;
  registeredOn?: string;
  vehicleClass?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  papers?: VehicleVerificationPapersInput;
  responsePayload?: Record<string, unknown>;
}

export interface CreateVehicleVerificationSnapshotData {
  tenantId: string;
  vehicleId: string;
  verificationType: VehicleVerificationType;
  verificationStatus: VehicleVerificationStatus;
  sourceReference: string | null;
  registeredName: string | null;
  registeredOn: string | null;
  vehicleClass: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pinCode: string | null;
  responsePayload: Record<string, unknown> | null;
  verifiedAt: Date | null;
  checkedAt: Date;
  createdBy: string | null;
}

/* Service & usage — one row per vehicle, feeds the maintenance reminders. */

export interface SetVehicleServiceUsageInput {
  odometerKm?: number;
  lastServiceDate?: string;
  lastServiceOdometerKm?: number;
  lastTyreChangeBrand?: string;
  lastTyreChangeDate?: string;
}

export interface CreateVehicleServiceUsageData {
  tenantId: string;
  vehicleId: string;
  odometerKm: number | null;
  lastServiceDate: string | null;
  lastServiceOdometerKm: number | null;
  lastTyreChangeBrand: string | null;
  lastTyreChangeDate: string | null;
  createdBy: string | null;
}

export interface UpdateVehicleServiceUsageData {
  odometerKm?: number | null;
  lastServiceDate?: string | null;
  lastServiceOdometerKm?: number | null;
  lastTyreChangeBrand?: string | null;
  lastTyreChangeDate?: string | null;
  updatedBy?: string | null;
}

/**
 * The whole "Add a vehicle" form in one request. Every section past the first is optional, and the
 * service applies them in a single transaction so a failure late on cannot leave a half-built vehicle.
 *
 * The driver link is deliberately not here: it spans the driver aggregate and is owned by
 * FleetDriverLinkService, so it stays a separate `POST /vehicles/:vehicleId/drivers` call.
 */
export interface OnboardVehicleInput extends CreateVehicleInput {
  verification?: RecordVehicleVerificationInput;
  telemetry?: SetVehicleTelemetryMetaInput;
  serviceUsage?: SetVehicleServiceUsageInput;
  documents?: AddVehicleDocumentInput[];
  operationalStatus?: SetVehicleOperationalStatusInput;
}
