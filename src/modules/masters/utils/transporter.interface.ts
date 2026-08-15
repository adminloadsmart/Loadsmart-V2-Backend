import { TransporterEntity } from '../entities/transporter.entity';
import { TransporterCompanyType } from './transporter.types';
import { PaginationInput, Paginated } from './masters.types';

export interface CreateTransporterInput {
  name: string;
  phone: string;
  rate?: string;
  email?: string;
  gstin?: string;
  msmeRegistration?: string;
  companyType?: TransporterCompanyType;
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
}
export interface UpdateTransporterInput {
  name?: string;
  phone?: string;
  rate?: string | null;
  email?: string | null;
  gstin?: string | null;
  msmeRegistration?: string | null;
  companyType?: TransporterCompanyType | null;
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
}
export interface ListTransportersInput extends PaginationInput {
  search?: string;
}
export type PaginatedTransporters = Paginated<TransporterEntity>;
