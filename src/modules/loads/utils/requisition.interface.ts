import { PaginationInput } from '../../masters/utils/masters.types';
import { RequisitionStatus } from './loads.types';

export interface CreateRequisitionInput {
  customerId: string;
  productId: string;
  quantityTonnes: number;
  loadingPointId: string;
  customerDeliveryPointId: string;
  expectedDeliveryDate: string;
  customerPoNumber: string;
}

export interface ListRequisitionsInput extends PaginationInput {
  search?: string;
  status?: RequisitionStatus;
  customerId?: string;
}

export interface CreateRequisitionData {
  tenantId: string;
  customerId: string;
  productId: string;
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
