import { PaginationInput } from '../../masters/utils/masters.types';
import { RequisitionStatus } from './loads.types';
import { OverrideInput } from './override.interface';

export interface RequisitionProductLineInput {
  productId: string;
  quantityTonnes: number;
}

export interface CreateRequisitionInput {
  customerId: string;
  /** At least one — Plan Dispatch v2.0 R-02: "A requisition can hold multiple products". */
  products: RequisitionProductLineInput[];
  loadingPointId: string;
  customerDeliveryPointId: string;
  expectedDeliveryDate: string;
  customerPoNumber: string;
  /** C-05 (duplicate PO/SO number) is the only overridable check at this stage. */
  overrides?: OverrideInput[];
}

export interface ListRequisitionsInput extends PaginationInput {
  search?: string;
  status?: RequisitionStatus;
  customerId?: string;
}

export interface CreateRequisitionData {
  tenantId: string;
  customerId: string;
  quantityTonnes: string;
  dispatchedTonnes: string;
  loadingPointId: string;
  customerDeliveryPointId: string;
  expectedDeliveryDate: string;
  customerPoNumber: string;
  status: RequisitionStatus;
  createdBy: string | null;
}

export interface ListRequisitionsFilters {
  page: number;
  limit: number;
  search?: string;
  status?: RequisitionStatus;
  customerId?: string;
}

export type RequisitionParams = { requisitionId: string };
