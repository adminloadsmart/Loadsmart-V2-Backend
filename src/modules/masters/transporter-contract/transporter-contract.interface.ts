import { PaginationInput } from '../../../shared/utils/pagination';
import { ContractStatusFilter, ContractUnit } from './transporter-contract.types';

export interface CreateTransporterContractInput {
  customerId: string;
  transporterId: string;
  pickupCity: string;
  pickupState: string;
  dropCity: string;
  dropState: string;
  rate: number;
  unit: ContractUnit;
  /** Defaults to today. */
  validFrom?: string;
  /** The contract expiry date. */
  validTo: string;
  /** 1 = P1. */
  priority: number;
  /** Share of business on the lane; defaults to 100 when the lane has no other contract. */
  sharePercent?: number;
}

export interface UpdateTransporterContractInput {
  transporterId?: string;
  pickupCity?: string;
  pickupState?: string;
  dropCity?: string;
  dropState?: string;
  rate?: number;
  unit?: ContractUnit;
  validFrom?: string;
  validTo?: string;
  priority?: number;
  sharePercent?: number;
}

export interface ListTransporterContractsInput extends PaginationInput {
  search?: string;
  customerId?: string;
  transporterId?: string;
  pickupCity?: string;
  dropCity?: string;
  status?: ContractStatusFilter;
}

export interface LaneSummaryQueryInput {
  customerId: string;
  pickupCity: string;
  pickupState: string;
  dropCity: string;
  dropState: string;
}
