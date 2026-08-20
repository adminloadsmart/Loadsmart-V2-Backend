import {
  DriverBloodGroup,
  DriverDocumentType,
  DriverDocumentVerificationSource,
  DriverOperationalStatus,
  DriverSalaryType,
  DriverStatus,
  DriverVerificationStatus,
  DriverVerificationType,
} from './drivers.types';
import { PaginationInput } from './masters.types';

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateDriverInput {
  fullName: string;
  phoneNumber: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  bloodGroup?: DriverBloodGroup;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  salaryType?: DriverSalaryType;
  salaryAmount?: number;
}

export interface UpdateDriverInput {
  fullName?: string;
  phoneNumber?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  bloodGroup?: DriverBloodGroup;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  salaryType?: DriverSalaryType;
  salaryAmount?: number;
  status?: DriverStatus;
}

export interface ListDriversInput extends PaginationInput {
  status?: DriverStatus;
  operationalStatus?: DriverOperationalStatus;
  search?: string;
}

/** Raw `req.query` shape for the list endpoint — normalized into `ListDriversInput` by the service. */
export interface ListDriversQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  status?: string;
  operationalStatus?: string;
}

export interface AddDriverDocumentInput {
  documentType: DriverDocumentType;
  fileUrl: string;
  documentNumber?: string;
  verificationSource?: DriverDocumentVerificationSource;
}

export interface RecordVerificationInput {
  verificationType: DriverVerificationType;
  verificationStatus: DriverVerificationStatus;
  sourceReference?: string;
  holderName?: string;
  licenseNumber?: string;
  validUntil?: string;
  licenseClass?: string;
  licenseStatus?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  rawResponse?: Record<string, unknown>;
}

export interface AddBankDetailsInput {
  accountNumber: string;
  ifsc: string;
  accountHolderName?: string;
}

/* Repository-layer data — shapes written to the database. */

export interface CreateDriverData {
  tenantId: string;
  fullName: string;
  phoneNumber: string;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  dateOfJoining: string | null;
  dateOfBirth: string | null;
  bloodGroup: DriverBloodGroup | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pinCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  salaryType: DriverSalaryType | null;
  salaryAmount: string | null;
  status: DriverStatus;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdBy: string | null;
}

export interface UpdateDriverData {
  fullName?: string;
  licenseNumber?: string | null;
  licenseVerified?: boolean;
  licenseExpiry?: string | null;
  dateOfJoining?: string | null;
  dateOfBirth?: string | null;
  bloodGroup?: DriverBloodGroup | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  pinCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  salaryType?: DriverSalaryType | null;
  salaryAmount?: string | null;
  status?: DriverStatus;
  updatedBy?: string | null;
}

export interface ListDriversFilters {
  status?: DriverStatus;
  operationalStatus?: DriverOperationalStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface CreateDriverDocumentData {
  tenantId: string;
  driverId: string;
  documentType: DriverDocumentType;
  fileUrl: string;
  documentNumber: string | null;
  verificationSource: DriverDocumentVerificationSource;
  verifiedAt: Date | null;
  createdBy: string | null;
}

export interface CreateDriverVerificationData {
  tenantId: string;
  driverId: string;
  verificationType: DriverVerificationType;
  verificationStatus: DriverVerificationStatus;
  sourceReference: string | null;
  holderName: string | null;
  licenseNumber: string | null;
  validUntil: string | null;
  licenseClass: string | null;
  licenseStatus: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pinCode: string | null;
  rawResponse: Record<string, unknown> | null;
  verifiedAt: Date | null;
  createdBy: string | null;
}

export interface CreateDriverBankDetailsData {
  tenantId: string;
  driverId: string;
  accountNumber: string;
  ifsc: string;
  accountHolderName: string | null;
  createdBy: string | null;
}

/* Operational status — one current row per driver. */

export interface SetDriverOperationalStatusInput {
  operationalStatus: DriverOperationalStatus;
  reason?: string;
  effectiveAt?: string;
}

export interface CreateDriverOperationalStatusData {
  tenantId: string;
  driverId: string;
  operationalStatus: DriverOperationalStatus;
  reason: string | null;
  effectiveAt: Date;
  createdBy: string | null;
}

export interface UpdateDriverOperationalStatusData {
  operationalStatus?: DriverOperationalStatus;
  reason?: string | null;
  effectiveAt?: Date;
  updatedBy?: string | null;
}

/* Trip metrics — one row per driver per reporting period. */

export interface RecordDriverTripMetricsInput {
  periodStart: string;
  periodEnd: string;
  tripsCount: number;
  onTimePercentage: number;
}

export interface CreateDriverTripMetricsData {
  tenantId: string;
  driverId: string;
  periodStart: string;
  periodEnd: string;
  tripsCount: number;
  onTimePercentage: string;
  createdBy: string | null;
}

export interface UpdateDriverTripMetricsData {
  tripsCount?: number;
  onTimePercentage?: string;
  updatedBy?: string | null;
}

/**
 * The whole "Add a driver" form in one request. Every section past the first is optional, and the
 * service applies them in a single transaction so a failure late on cannot leave a half-built driver.
 *
 * The vehicle link is deliberately not here: it spans the vehicle aggregate and is owned by
 * FleetDriverLinkService, so it stays a separate `POST /vehicles/:vehicleId/drivers` call.
 */
export interface OnboardDriverInput extends CreateDriverInput {
  verification?: RecordVerificationInput;
  bankDetails?: AddBankDetailsInput;
  documents?: AddDriverDocumentInput[];
  operationalStatus?: SetDriverOperationalStatusInput;
}
