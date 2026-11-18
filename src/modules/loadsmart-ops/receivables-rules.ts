import type { LoadStatus } from '../loads/utils/loads.types';
import type { InvoiceStatus } from './loadsmart.types';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Receivables board (R01): one row per Loadsmart load from the truck loaded to the shipper's money
 * closing, each in one status, plus what the shipper owes as advance. Pure — the service feeds
 * it the load, its invoice and the money already in.
 */

/** Who settles the balance: the shipper, or the consignee at the drop (shipper terms). */
export const BALANCE_PAYERS = ['shipper', 'consignee'] as const;
export type BalancePayer = (typeof BALANCE_PAYERS)[number];

/** The original POD on its way from Loadsmart to the balance payer (after the carrier's original
 *  reached Loadsmart — Payables' tracker). */
export const PAYER_POD_STATUSES = ['not_sent', 'in_transit', 'received'] as const;
export type PayerPodStatus = (typeof PAYER_POD_STATUSES)[number];

/** Per-invoice GST: reverse charge (the recipient pays it) or forward (Loadsmart charges it). */
export const GST_TREATMENTS = ['reverse_charge', 'forward_charge'] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];

/** The board's status chips, in the order a load moves through them. */
export const RECEIVABLE_STATUSES = [
  'advance_due',
  'advance_paid',
  'pod_image_in',
  'invoice_generated',
  'awaiting_original_pod',
  'pod_in_transit',
  'pod_received_by_payer',
  'invoice_paid_closed',
  'short_excess',
] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

/** From the truck loaded onwards the shipper owes Loadsmart money. */
export const RECEIVABLE_LOAD_STATUSES: readonly LoadStatus[] = [
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
  'delivered_ok',
  'delivered_with_issues',
  'invoice_generated',
  'payment',
  'closed',
];

/** "Advance calculation: X% of freight + shipper-approved loading charges" — the percent of the
 *  freight plus the approved loading-side charges (those are paid with the advance). */
export function expectedAdvance(
  percent: number,
  freight: number,
  approvedLoadingCharges: number,
): number {
  if (percent <= 0) return 0;
  return round2(((freight + approvedLoadingCharges) * percent) / 100);
}

export interface ReceivableStatusInput {
  loadStatus: LoadStatus;
  /** POD image uploaded on the load. */
  podIn: boolean;
  invoiceStatus: InvoiceStatus | null;
  /** The shipper bills on the physical original (terms podType 'original'). */
  needsOriginalPod: boolean;
  /** The carrier's original reached Loadsmart (Payables' tracker). */
  originalPodAtLoadsmart: boolean;
  payerPodStatus: PayerPodStatus;
  advanceExpected: number;
  advanceReceived: number;
}

/** The one status a load shows on the board — the furthest it has got. */
export function receivableStatus(input: ReceivableStatusInput): ReceivableStatus {
  const invoice = input.invoiceStatus;
  if (invoice === 'paid') return 'invoice_paid_closed';
  if (invoice === 'short_paid' || invoice === 'excess' || invoice === 'partly_paid') {
    return 'short_excess';
  }
  if (invoice === 'issued') {
    if (input.needsOriginalPod) {
      if (input.payerPodStatus === 'received') return 'pod_received_by_payer';
      if (input.payerPodStatus === 'in_transit') return 'pod_in_transit';
      if (!input.originalPodAtLoadsmart) return 'awaiting_original_pod';
    }
    return 'invoice_generated';
  }
  if (input.loadStatus === 'closed') return 'invoice_paid_closed';
  if (input.podIn) {
    return input.needsOriginalPod && !input.originalPodAtLoadsmart
      ? 'awaiting_original_pod'
      : 'pod_image_in';
  }
  if (input.advanceExpected > 0 && input.advanceReceived + 0.005 < input.advanceExpected) {
    return 'advance_due';
  }
  return 'advance_paid';
}
