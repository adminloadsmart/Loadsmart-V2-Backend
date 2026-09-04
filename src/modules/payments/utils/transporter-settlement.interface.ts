export interface RecordTransporterSettlementInput {
  utrReference: string;
  proofFileKey?: string;
  paymentDate: string;
}

export interface TransporterSettlementSummary {
  loadId: string;
  transporterId: string;
  totalOwed: string;
  totalPaid: string;
  remainingAmount: string;
  bankDetailsOnFile: boolean;
  alreadySettled: boolean;
}
