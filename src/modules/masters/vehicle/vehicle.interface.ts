import { PaginationInput } from '../../../shared/utils/pagination';
import { LinkDriverInput } from '../fleet-driver-link/fleet-driver-link.interface';
import { PickerBody } from './truck-type-picker.constants';
import {
  TyreConditionPreset,
  VehicleAxleType,
  VehicleBodyType,
  VehicleCostPayer,
  VehicleDocumentStatus,
  VehicleDocumentType,
  VehicleDocumentTypeWithExpiry,
  VehicleFuelType,
  VehicleOperationalStatus,
  VehicleOwnershipType,
  VehicleStatus,
  VehicleTollPayer,
  VehicleVerificationStatus,
  VehicleVerificationType,
} from './vehicle.type';

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateVehicleInput {
  registrationNumber: string;
  truckTypeId?: string;
  fuelType?: VehicleFuelType;
  bodyType?: VehicleBodyType;
  makeModel?: string;
  wheelCount?: number;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
  axleType?: VehicleAxleType;
  bodyLengthFt?: string;
  grossVehicleWeightKg?: number;
  unladenWeightKg?: number;
  emissionNorm?: string;
  vahanBodyType?: string;
  financierName?: string;
}

export interface UpdateVehicleInput {
  truckTypeId?: string;
  fuelType?: VehicleFuelType;
  bodyType?: VehicleBodyType;
  makeModel?: string;
  wheelCount?: number;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
  axleType?: VehicleAxleType;
  bodyLengthFt?: string;
  status?: VehicleStatus;
  /** Re-links this driver as the vehicle's primary driver — see FleetDriverLinkService.setPrimaryDriver. */
  driverId?: string;
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

export interface ListComplianceAlertsInput extends PaginationInput {
  documentType?: VehicleDocumentTypeWithExpiry;
  search?: string;
}

export interface AddVehicleDocumentInput {
  documentType: VehicleDocumentType;
  documentNumber?: string;
  providerName?: string;
  issueDate?: string;
  expiryDate?: string;
  fileUrl?: string;
}

export interface UpdateVehicleDocumentInput {
  documentNumber?: string;
  providerName?: string;
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
  makeModel: string | null;
  wheelCount: number | null;
  capacityTons: string | null;
  ownershipType: VehicleOwnershipType;
  axleType: VehicleAxleType | null;
  bodyLengthFt: string | null;
  grossVehicleWeightKg: number | null;
  unladenWeightKg: number | null;
  emissionNorm: string | null;
  vahanBodyType: string | null;
  financierName: string | null;
  status: VehicleStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdBy: string | null;
}

export interface UpdateVehicleData {
  truckTypeId?: string | null;
  fuelType?: VehicleFuelType | null;
  bodyType?: VehicleBodyType | null;
  makeModel?: string | null;
  wheelCount?: number | null;
  capacityTons?: string | null;
  ownershipType?: VehicleOwnershipType;
  axleType?: VehicleAxleType | null;
  bodyLengthFt?: string | null;
  status?: VehicleStatus;
  updatedBy?: string | null;
}

export interface ExportVehiclesFilters {
  status?: VehicleStatus;
  operationalStatus?: VehicleOperationalStatus;
  search?: string;
}

export interface ListVehiclesFilters {
  status?: VehicleStatus;
  operationalStatus?: VehicleOperationalStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface ListComplianceAlertsFilters {
  documentType?: VehicleDocumentTypeWithExpiry;
  search?: string;
  page: number;
  limit: number;
  /** today + DOCUMENT_EXPIRING_SOON_DAYS + 1, computed by the service — see listComplianceAlerts. */
  expiryBefore: string;
}

export interface CreateVehicleDocumentData {
  tenantId: string;
  vehicleId: string;
  documentType: VehicleDocumentType;
  documentNumber: string | null;
  providerName?: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  fileUrl: string | null;
  status: VehicleDocumentStatus;
  createdBy: string | null;
}

export interface UpdateVehicleDocumentData {
  documentNumber?: string | null;
  providerName?: string | null;
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
  hasGps?: boolean;
  gpsDeviceImei?: string;
  emiAmount?: number;
  emiEndDate?: string;
  insurancePremiumYearly?: number;
  leaseRentMonthly?: number;
  leaseEndDate?: string;
  fuelPaidBy?: VehicleCostPayer;
  tollPaidBy?: VehicleTollPayer;
  fixedCostMonthly?: number;
}

export interface CreateVehicleTelemetryMetaData {
  tenantId: string;
  vehicleId: string;
  gpsProvider: string | null;
  gpsEnabled: boolean;
  hasGps: boolean | null;
  gpsDeviceImei: string | null;
  emiAmount: string | null;
  emiEndDate: string | null;
  insurancePremiumYearly: string | null;
  leaseRentMonthly: string | null;
  leaseEndDate: string | null;
  fuelPaidBy: VehicleCostPayer | null;
  tollPaidBy: VehicleTollPayer | null;
  fixedCostMonthly: string | null;
  createdBy: string | null;
}

export interface UpdateVehicleTelemetryMetaData {
  gpsProvider?: string | null;
  gpsEnabled?: boolean;
  hasGps?: boolean | null;
  gpsDeviceImei?: string | null;
  emiAmount?: string | null;
  emiEndDate?: string | null;
  insurancePremiumYearly?: string | null;
  leaseRentMonthly?: string | null;
  leaseEndDate?: string | null;
  fuelPaidBy?: VehicleCostPayer | null;
  tollPaidBy?: VehicleTollPayer | null;
  fixedCostMonthly?: string | null;
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
  roadTaxValidTo?: string;
  /** The insurer, written onto the insurance document. */
  insuranceProvider?: string;
}

export interface RecordVehicleVerificationInput {
  verificationType: VehicleVerificationType;
  verificationStatus: VehicleVerificationStatus;
  sourceReference?: string;
  registeredName?: string;
  registeredOn?: string;
  vehicleClass?: string;
  registeringAuthority?: string;
  financierName?: string;
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
  registeringAuthority: string | null;
  financierName: string | null;
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
  serviceIntervalKm?: number;
  serviceIntervalMonths?: number;
}

export interface CreateVehicleServiceUsageData {
  tenantId: string;
  vehicleId: string;
  odometerKm: number | null;
  lastServiceDate: string | null;
  lastServiceOdometerKm: number | null;
  lastTyreChangeBrand: string | null;
  lastTyreChangeDate: string | null;
  serviceIntervalKm: number | null;
  serviceIntervalMonths: number | null;
  createdBy: string | null;
}

export interface UpdateVehicleServiceUsageData {
  odometerKm?: number | null;
  lastServiceDate?: string | null;
  lastServiceOdometerKm?: number | null;
  lastTyreChangeBrand?: string | null;
  lastTyreChangeDate?: string | null;
  serviceIntervalKm?: number | null;
  serviceIntervalMonths?: number | null;
  updatedBy?: string | null;
}

/** The truck-type picker's four steps — body, then a tyre count or (32 ft containers) an axle type,
 *  then tonnes, then feet. Must be a combination TRUCK_TYPE_PICKER_ROWS offers. */
export interface TruckTypePickInput {
  body: PickerBody;
  wheelCount?: number;
  axleType?: VehicleAxleType;
  capacityTons: number;
  bodyLengthFt: string;
}

/** "Truck cost" (owned/financed) or "Lease and trip cost" (attached). */
export interface OnboardVehicleCostInput {
  emiAmount?: number;
  /** "Months left" on the loan — stored as emi_end_date, counted from today. */
  emiMonthsLeft?: number;
  insurancePremiumYearly?: number;
  leaseRentMonthly?: number;
  leaseEndDate?: string;
  fuelPaidBy?: VehicleCostPayer;
  tollPaidBy?: VehicleTollPayer;
}

export interface OnboardVehicleGpsInput {
  hasGps: boolean;
  provider?: string;
  deviceImei?: string;
}

/** One position the operator measured or corrected after the whole-set preset. */
export interface TyrePositionInput {
  position: string;
  treadMm: number;
  fittedAt?: string;
  brand?: string;
}

/** "Tyre life": every position starts at the preset's depth, then `positions` override some. */
export interface InitialTyreSetInput {
  preset: TyreConditionPreset;
  positions?: TyrePositionInput[];
}

/**
 * The whole "Add a vehicle" form in one request. Every section past the first is optional, and the
 * service applies them in a single transaction so a failure late on cannot leave a half-built vehicle.
 *
 * `driverLink` is optional because a vehicle can be onboarded before any driver is assigned; when
 * present, VehicleService hands it to FleetDriverLinkService.linkDriver inside the same transaction,
 * so the vehicle and its driver link succeed or fail together. The same link can also be made (or
 * changed) later via a standalone `POST /vehicles/:vehicleId/drivers` call.
 */
export interface OnboardVehicleInput extends CreateVehicleInput {
  truckType?: TruckTypePickInput;
  verification?: RecordVehicleVerificationInput;
  cost?: OnboardVehicleCostInput;
  gps?: OnboardVehicleGpsInput;
  tyres?: InitialTyreSetInput;
  /** @deprecated — the old form's EMI/GPS block; use `cost` and `gps`. */
  telemetry?: SetVehicleTelemetryMetaInput;
  serviceUsage?: SetVehicleServiceUsageInput;
  documents?: AddVehicleDocumentInput[];
  operationalStatus?: SetVehicleOperationalStatusInput;
  driverLink?: LinkDriverInput;
}

/* Route parameter shapes, used to type `Request<P>` in the controller. */

export type VehicleParams = { vehicleId: string };
export type VehicleDocumentParams = { vehicleId: string; documentId: string };
