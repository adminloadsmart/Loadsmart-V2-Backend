import { TransporterEntity } from './entities/transporter.entity';
import {
  TransporterCompanyType,
  TransporterGstTreatment,
  TransporterStatus,
} from './transporter.types';
import { PaginationInput, Paginated } from '../../../shared/utils/pagination';
import { PickerBody } from '../vehicle/truck-type-picker.constants';

/** A POC card. With `id` on update it edits that row in place; without one it's new. */
export interface TransporterContactInput {
  id?: string;
  fullName?: string | null;
  designation?: string | null;
  phone?: string | null;
  isWhatsapp?: boolean;
  email?: string | null;
}

/** An operating lane. With `id` on update it edits that row in place; without one it's new. */
export interface TransporterLaneInput {
  id?: string;
  originCity: string;
  originState?: string | null;
  destinationCity: string;
  destinationState?: string | null;
  distanceKm?: number | null;
}

/** "Truck type" picker: body · tyres · tonnes · feet (e.g. Open · 12 tyre · 25 T · 24 ft). */
export interface TransporterTruckTypeInput {
  bodyType?: PickerBody | null;
  wheelCount?: number | null;
  capacityTons?: number | null;
  lengthFt?: number | null;
}

export interface CreateTransporterInput {
  name: string;
  phone: string;
  rate?: string;
  email?: string;
  gstin?: string;
  /** masters.gst_verifications id from POST /masters/gst/verify. */
  gstVerificationId?: string;
  msmeRegistration?: string;
  companyType?: TransporterCompanyType;
  status?: TransporterStatus;
  advancePercentage?: number;
  creditDays?: number;
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  areaLocality?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankAccountHolderName?: string;
  bankNameBranch?: string;
  upiVpa?: string;
  gstTreatment?: TransporterGstTreatment;
  trucksDeclared?: number;
  truckType?: TransporterTruckTypeInput;
  contacts?: TransporterContactInput[];
  lanes?: TransporterLaneInput[];
}
export interface UpdateTransporterInput {
  name?: string;
  phone?: string;
  rate?: string | null;
  email?: string | null;
  gstin?: string | null;
  gstVerificationId?: string | null;
  msmeRegistration?: string | null;
  companyType?: TransporterCompanyType | null;
  status?: TransporterStatus;
  advancePercentage?: number | null;
  creditDays?: number | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  landmark?: string | null;
  areaLocality?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankAccountHolderName?: string | null;
  bankNameBranch?: string | null;
  upiVpa?: string | null;
  gstTreatment?: TransporterGstTreatment | null;
  trucksDeclared?: number | null;
  truckType?: TransporterTruckTypeInput | null;
  contacts?: TransporterContactInput[];
  lanes?: TransporterLaneInput[];
}

export const TRANSPORTER_SORT_FIELDS = ['tripsDone', 'freightOwed', 'createdAt', 'name'] as const;
export type TransporterSortField = (typeof TRANSPORTER_SORT_FIELDS)[number];

export interface ListTransportersInput extends PaginationInput {
  search?: string;
  status?: TransporterStatus;
  sortBy?: TransporterSortField;
  sortOrder?: 'asc' | 'desc';
}
export type PaginatedTransporters = Paginated<TransporterEntity>;
