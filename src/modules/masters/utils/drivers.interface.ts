import {
  DriverDocumentType,
  DriverDocumentVerificationSource,
  DriverStatus,
  DriverVerificationStatus,
  DriverVerificationType,
} from "./drivers.types";
import { PaginationInput } from "./masters.types";

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateDriverInput {
  fullName: string;
  phoneNumber: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
}

export interface UpdateDriverInput {
  fullName?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  dateOfJoining?: string;
  status?: DriverStatus;
}

export interface ListDriversInput extends PaginationInput {
  status?: DriverStatus;
  search?: string;
}

export interface AddDriverDocumentInput {
  documentType: DriverDocumentType;
  fileUrl: string;
  verificationSource?: DriverDocumentVerificationSource;
}

export interface RecordVerificationInput {
  verificationType: DriverVerificationType;
  verificationStatus: DriverVerificationStatus;
  sourceReference?: string;
  holderName?: string;
  licenseNumber?: string;
  validUntil?: string;
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
  createdBy: string | null;
}

export interface UpdateDriverData {
  fullName?: string;
  licenseNumber?: string | null;
  licenseVerified?: boolean;
  licenseExpiry?: string | null;
  dateOfJoining?: string | null;
  status?: DriverStatus;
  updatedBy?: string | null;
}

export interface ListDriversFilters {
  status?: DriverStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface CreateDriverDocumentData {
  tenantId: string;
  driverId: string;
  documentType: DriverDocumentType;
  fileUrl: string;
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
