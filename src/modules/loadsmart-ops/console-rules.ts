import {
  hasPermission,
  PermissionHolder,
} from '../../shared/middleware/require-permission.middleware';
import {
  LS_APPROVAL,
  LS_MONEY_APPROVE,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_RECEIVABLES,
  LS_SETTINGS_MANAGE,
  LS_TRACKING,
} from '../../shared/constants/permissions';
import { LoadStatus } from '../loads/utils/loads.types';
import { InvoiceStatus, SourcingStatus } from './loadsmart.types';

/** Pure rules for the console's read views (L01, S01, S02, T07) — no DB/IO; unit-tested in
 *  console.test.ts. */

export const CONSOLE_TEAMS = [
  'approval',
  'placement',
  'tracking',
  'cs',
  'receivables',
  'payables',
  'closed',
  'off_loadsmart', // lost, cancelled, or never Loadsmart's
] as const;
export type ConsoleTeam = (typeof CONSOLE_TEAMS)[number];

const EXECUTION: readonly LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
];

export interface TeamHoldingInput {
  sourcingStatus: SourcingStatus;
  loadStatus: LoadStatus;
  claimOpen: boolean;
  invoiceStatus: InvoiceStatus | null;
  carrierBalancePaid: boolean;
}

/** "Every load whichever team holds it" — the team whose queue the load is in now. After
 *  delivery Receivables bills while Payables chases the original POD; the load counts as
 *  Receivables' until the shipper is settled, then Payables' until the carrier is paid. */
export function teamHolding(input: TeamHoldingInput): ConsoleTeam {
  const { sourcingStatus, loadStatus } = input;
  if (sourcingStatus === 'pending_approval') return 'approval';
  if (sourcingStatus === 'posted' || sourcingStatus === 'bid_sent') return 'placement';
  if (sourcingStatus !== 'won') return 'off_loadsmart';
  if (loadStatus === 'closed') return 'closed';
  if (loadStatus === 'created' || loadStatus === 'bids_received') return 'placement';
  if (EXECUTION.includes(loadStatus)) return 'tracking';
  if (loadStatus === 'delivered_with_issues' && input.claimOpen) return 'cs';
  const shipperSettled =
    input.invoiceStatus === 'paid' ||
    input.invoiceStatus === 'short_paid' ||
    input.invoiceStatus === 'excess';
  if (!shipperSettled) return 'receivables';
  return input.carrierBalancePaid ? 'closed' : 'payables';
}

/** "Money they see": Placement sees both sides and the margin; Tracking and Payables only carrier
 *  money; Receivables and Approval only shipper money; CS none; Super Admin everything. */
export function moneyVisibility(actor: PermissionHolder) {
  const any = (...keys: string[]) => keys.some((key) => hasPermission(actor, key));
  const everything = any(LS_MONEY_APPROVE, LS_SETTINGS_MANAGE);
  const shipper = everything || any(LS_PLACEMENT, LS_RECEIVABLES, LS_APPROVAL);
  const carrier = everything || any(LS_PLACEMENT, LS_TRACKING, LS_PAYABLES);
  return { shipper, carrier, margin: shipper && carrier };
}

export const LIVE_STATUSES = ['moving', 'at_a_stop', 'no_signal', 'needs_action'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

const NO_SIGNAL_MS = 2 * 60 * 60 * 1000;

export interface LiveStatusInput {
  position: { recordedAt: Date; stale: boolean } | null;
  /** Tracking's halt flag, when it sends one (not in its API yet). */
  halted?: boolean;
  /** Something waits on Tracking: papers to review, the POD to decide, no unloading details. */
  pendingAction: boolean;
  /** The tracking ETA is past the promised delivery. */
  runningLate: boolean;
}

/** T07: "every live load by status (moving, at a stop, no signal 2 h, needs action)". */
export function liveStatus(input: LiveStatusInput, now: Date): LiveStatus {
  if (input.pendingAction || input.runningLate) return 'needs_action';
  if (!input.position || now.getTime() - input.position.recordedAt.getTime() > NO_SIGNAL_MS) {
    return 'no_signal';
  }
  if (input.halted) return 'at_a_stop';
  return 'moving';
}

/** The middle value (the mean of the two middle ones for an even count); null when empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The period just before [from, to), the same length — S02 compares the two. */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const length = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - length), to: new Date(from.getTime()) };
}

/** Change from the previous period, as a percentage (null when there's nothing to compare). */
export function changePercent(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
