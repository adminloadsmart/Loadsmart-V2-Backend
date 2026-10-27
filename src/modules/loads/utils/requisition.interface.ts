import { PaginationInput } from '../../../shared/utils/pagination';
import { RequisitionItemUnit, RequisitionStatus } from './loads.types';
import { OverrideInput } from './override.interface';

/**
 * `quantityTonnes` is the mandatory figure the module runs on and, if given, always wins
 * ("typing directly overrides it" — Plan Dispatch v2.0 §4.1). If omitted, `quantity`+`unit` are
 * both required and the service derives tonnage from the product's weight per pack.
 */
export interface RequisitionProductLineInput {
  productId: string;
  quantityTonnes?: number;
  quantity?: number;
  unit?: RequisitionItemUnit;
}

export interface CreateRequisitionInput {
  customerId: string;
  /** At least one — Plan Dispatch v2.0 R-02: "A requisition can hold multiple products". */
  products: RequisitionProductLineInput[];
  loadingPointId: string;
  customerDeliveryPointId: string;
  /** When the truck is expected to pick up from the loading point — must not be after
   *  expectedDeliveryDate. */
  pickupDate: string;
  expectedDeliveryDate: string;
  customerPoNumber: string;
  /** Optional value of the cargo per MT — a shortage's value at risk (LS_N_0034). */
  cargoValuePerTonne?: number;
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
  code: string;
  customerId: string;
  quantityTonnes: string;
  dispatchedTonnes: string;
  loadingPointId: string;
  customerDeliveryPointId: string;
  pickupDate: string;
  expectedDeliveryDate: string;
  customerPoNumber: string;
  cargoValuePerTonne: string | null;
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
