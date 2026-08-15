import { CustomerStatus } from './utils/customer.status';

export interface DeliveryPointInput {
  location: string;
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  areaLocality?: string;
  city?: string;
  state?: string;
  pinCode?: string;
}

export interface CreateCustomerInput {
  name: string;
  mobile: string;
  email?: string;
  gstin?: string;
  deliveryPoints?: DeliveryPointInput[];
  advancePercentage?: number;
  balancePercentage?: number;
  creditDays?: number;
  rateContract?: string;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingLandmark?: string;
  billingAreaLocality?: string;
  billingCity?: string;
  billingState?: string;
  billingPinCode?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  mobile?: string;
  email?: string | null;
  gstin?: string | null;
  deliveryPoints?: DeliveryPointInput[];
  advancePercentage?: number | null;
  balancePercentage?: number | null;
  creditDays?: number | null;
  rateContract?: string | null;
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingLandmark?: string | null;
  billingAreaLocality?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPinCode?: string | null;
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

export interface DeleteCustomerParams {
  customer_id: string;
}
