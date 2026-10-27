import { humanizeStatus } from '../../../shared/utils/humanize';
import { LOAD_STAGE_TRANSITIONS, LoadSourceType, LoadStatus, ROUTE_STAGES } from './loads.types';
import { StageGateLoad, StagePathLoad } from './load.interface';

/**
 * Pure rules of the 13-stage lifecycle — no DB/IO, so they're unit-tested on their own
 * (load-stages.test.ts). LoadStageService is the only caller that acts on them.
 */

/** Why `from -> to` isn't allowed for this route, or null when it is. */
export function stageTransitionError(
  sourceType: LoadSourceType,
  from: LoadStatus,
  to: LoadStatus,
): string | null {
  const routeStages = ROUTE_STAGES[sourceType];
  if (!routeStages.includes(from) || !routeStages.includes(to)) {
    return `A ${humanizeStatus(sourceType)} load never goes through ${humanizeStatus(routeStages.includes(from) ? to : from)}`;
  }
  // A route with the money stages (Loadsmart) closes only after payment, never from delivered.
  const hasMoneyStages = routeStages.includes('payment');
  const allowed = LOAD_STAGE_TRANSITIONS[from].filter(
    (stage) =>
      routeStages.includes(stage) &&
      !(hasMoneyStages && from === 'delivered_ok' && stage === 'closed'),
  );
  if (!allowed.includes(to)) {
    const next = allowed.length ? allowed.map(humanizeStatus).join(' or ') : 'none';
    return `Cannot move load from ${humanizeStatus(from)} to ${humanizeStatus(to)} — the valid next stage is ${next}`;
  }
  return null;
}

export interface LoadingPapers {
  invoiceNumber: string | null;
  invoiceFileKey: string | null;
  ewayBillNumber: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
}

/** "3 papers move it to Loaded": invoice, e-way bill and the signed LR. Weighing slip and truck
 *  photos are optional. The LR number is not required — only the signed copy. */
export function hasLoadingPapers(load: LoadingPapers): boolean {
  return (
    !!load.invoiceNumber &&
    !!load.invoiceFileKey &&
    !!load.ewayBillNumber &&
    !!load.ewayBillFileKey &&
    !!load.elrFileKey
  );
}

/** The stages this load's stepper shows, in the order it goes through them. Only one delivered
 *  stage is shown unless the load took the issues branch, in which case Delivered with issues
 *  comes first and Delivered without issues (the settlement) after it. */
export function stagePathFor(load: StagePathLoad): LoadStatus[] {
  const tookIssuesBranch =
    load.status === 'delivered_with_issues' || load.deliveryIssueSettledAt !== null;
  const path: LoadStatus[] = [];
  for (const stage of ROUTE_STAGES[load.sourceType]) {
    if (stage === 'delivered_ok' && tookIssuesBranch) path.push('delivered_with_issues');
    if (stage === 'delivered_with_issues') continue;
    path.push(stage);
  }
  return path;
}

/** A business precondition a move needs beyond the route order, or null. Market and indent loads
 *  start the trip only once the shipper has accepted the load memo; own fleet has no memo. */
export function stageGateError(load: StageGateLoad, to: LoadStatus): string | null {
  if (to === 'in_transit_loading' && load.sourceType !== 'own_fleet' && !load.memoAcceptedAt) {
    return 'The shipper has to accept the load memo before the trip starts';
  }
  // "Truck waits for approval": on a Loadsmart load the papers are approved first.
  if (to === 'loaded' && load.sourceType === 'loadsmart' && !load.lsPapersApprovedAt) {
    return 'Approve the loading papers first';
  }
  // "Original POD unlocks money" — and it follows an accepted E-POD.
  if (to === 'original_pod_received' && load.podStatus !== 'accepted') {
    return 'The E-POD has to be approved before the original POD is marked received';
  }
  return null;
}
