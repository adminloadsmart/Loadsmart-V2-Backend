import { CustomerGstStatus, CustomerInvoiceAgainst, CustomerStatus } from './utils/customer.status';

/** An unloading point. With `id` on update it edits that row in place; without one it's new. */
export interface DeliveryPointInput {
  id?: string;
  location: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  landmark?: string | null;
  areaLocality?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googlePlaceId?: string | null;
  geofenceRadiusM?: number | null;
  pocName?: string | null;
  pocPhone?: string | null;
  pocEmail?: string | null;
}

/** A point of contact. With `id` on update it edits that row in place; without one it's new. */
export interface CustomerContactInput {
  id?: string;
  fullName?: string | null;
  designation?: string | null;
  phone?: string | null;
  isWhatsapp?: boolean;
  email?: string | null;
}

export interface CreateCustomerInput {
  name: string;
  gstin?: string;
  /** masters.gst_verifications id from POST /masters/gst/verify — see GstVerificationService. */
  gstVerificationId?: string;
  registeredAddress?: string;
  contacts?: CustomerContactInput[];
  deliveryPoints?: DeliveryPointInput[];
  notes?: string;
  invoiceAgainst?: CustomerInvoiceAgainst;
  freeHoursAtDrop?: number;
  balanceAmount?: number;
  creditLimit?: number;
  creditDays?: number;
  // --- Legacy (old Settings form, bulk import, Post a load quick-add) ---
  /** Optional only for name-only quick-add from Post a load (CustomerService.quickAdd). */
  mobile?: string;
  email?: string;
  contactPersonName?: string;
  contactPersonNumber?: string;
  contactPersonEmail?: string;
  contactPersonDesignation?: string;
  contactPersonDesignationOther?: string;
  advancePercentage?: number;
  balancePercentage?: number;
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
  gstin?: string | null;
  gstVerificationId?: string | null;
  registeredAddress?: string | null;
  contacts?: CustomerContactInput[];
  deliveryPoints?: DeliveryPointInput[];
  notes?: string | null;
  invoiceAgainst?: CustomerInvoiceAgainst | null;
  freeHoursAtDrop?: number | null;
  balanceAmount?: number | null;
  creditLimit?: number | null;
  creditDays?: number | null;
  mobile?: string;
  email?: string | null;
  contactPersonName?: string | null;
  contactPersonNumber?: string | null;
  contactPersonEmail?: string | null;
  contactPersonDesignation?: string | null;
  contactPersonDesignationOther?: string | null;
  advancePercentage?: number | null;
  balancePercentage?: number | null;
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
  gstVerificationStatus?: CustomerGstStatus;
}

export interface CustomerParams {
  customerId: string;
}

export interface DeleteCustomerParams {
  customer_id: string;
}
