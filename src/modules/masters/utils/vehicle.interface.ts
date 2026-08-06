import { PaginationInput } from "./masters.types";
import {
  VehicleDocumentStatus,
  VehicleDocumentType,
  VehicleOwnershipType,
  VehicleStatus,
} from "./vehicle.type";

/* Service-layer inputs — shapes accepted from the controller. */

export interface CreateVehicleInput {
  registrationNumber: string;
  vehicleType?: string;
  make?: string;
  model?: string;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
}

export interface UpdateVehicleInput {
  vehicleType?: string;
  make?: string;
  model?: string;
  capacityTons?: number;
  ownershipType?: VehicleOwnershipType;
  status?: VehicleStatus;
}

export interface ListVehiclesInput extends PaginationInput {
  status?: VehicleStatus;
  search?: string;
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
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  capacityTons: string | null;
  ownershipType: VehicleOwnershipType;
  createdBy: string | null;
}

export interface UpdateVehicleData {
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  capacityTons?: string | null;
  ownershipType?: VehicleOwnershipType;
  status?: VehicleStatus;
  updatedBy?: string | null;
}

export interface ListVehiclesFilters {
  status?: VehicleStatus;
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
