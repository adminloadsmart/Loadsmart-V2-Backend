import { CustomerStatus } from './utils/customer.status';

export interface DeliveryPointInput {
  location: string;
}

export interface CreateCustomerInput {
  name: string;
  mobile: string;
  email?: string;
  gstin?: string;
  deliveryPoints?: DeliveryPointInput[];
  advancePercentage?: number;
  creditDays?: number;
  rateContract?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  mobile?: string;
  email?: string | null;
  gstin?: string | null;
  deliveryPoints?: DeliveryPointInput[];
  advancePercentage?: number | null;
  creditDays?: number | null;
  rateContract?: string | null;
}

export interface ListCustomersInput {
  page: number;
  limit: number;
  search?: string;
  status?: CustomerStatus;
}

export interface CustomerParams {
  customerId: string;
}
