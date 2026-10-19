import { PaginationInput } from '../../../shared/utils/pagination';
import { ContractBillingUnit, ContractDisplayStatus, ContractSortField } from './contract.types';

/** A lane: city + state on both ends ("Mohali, Punjab → Bhiwandi, Maharashtra"). */
export interface ContractLane {
  sourceCity: string;
  sourceState: string;
  destinationCity: string;
  destinationState: string;
}

export interface CreateContractInput extends ContractLane {
  transporterId: string;
  agreedRate: number;
  billingUnit: ContractBillingUnit;
  /** 'YYYY-MM-DD' */
  validFrom: string;
  validTo: string;
  priority: number;
  sharePercentage?: number | null;
  notes?: string | null;
}

export type UpdateContractInput = Partial<CreateContractInput>;

export interface ListContractsInput extends PaginationInput {
  search?: string;
  status?: ContractDisplayStatus;
  transporterId?: string;
  sortBy?: ContractSortField;
  sortOrder?: 'asc' | 'desc';
}

export interface LaneAllocationInput extends ContractLane {
  excludeContractId?: string;
}
