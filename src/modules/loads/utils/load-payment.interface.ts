export interface RecordAdvanceInput {
  utrReference: string;
  paymentDate: string;
}

export interface RecordBalanceInput {
  utrReference: string;
  paymentDate: string;
}

/** Loadsmart's invoice lookup — set by the Loadsmart ops module, which owns the invoices. */
export interface LoadsmartBilling {
  balanceDueOf(tenantId: string, loadId: string): Promise<string | null>;
}
