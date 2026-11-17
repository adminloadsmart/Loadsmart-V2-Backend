import { LIFECYCLE_STAGES, LoadStatus, OWN_FLEET_STAGES } from './loads.types';
import { StagePathLoad } from './load.interface';

/**
 * Pure helpers over the 13 stages for reading a load — its stepper path and progress. Which move
 * is allowed lives in core/stage-rules.ts.
 */

export interface LoadingPapers {
  invoiceNumber: string | null;
  invoiceFileKey: string | null;
  ewayBillNumber: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
}

/** "3 papers move it to Loaded": invoice, e-way bill and the signed LR. */
export function hasLoadingPapers(load: LoadingPapers): boolean {
  return (
    !!load.invoiceNumber &&
    !!load.invoiceFileKey &&
    !!load.ewayBillNumber &&
    !!load.ewayBillFileKey &&
    !!load.elrFileKey
  );
}

/** A Loadsmart load, or a market load whose Loadsmart award is waiting on its memo. */
export function isLoadsmartLoad(load: {
  route: string | null;
  awardedParty: string | null;
}): boolean {
  return load.route === 'loadsmart' || (load.route === null && load.awardedParty === 'loadsmart');
}

/** The stages this load's stepper shows, in the order it goes through them. Only one delivered
 *  stage is shown unless the load took the issues branch, in which case Delivered with issues
 *  comes first and Delivered (the resolution) after it. */
export function stagePathFor(load: StagePathLoad): LoadStatus[] {
  const tookIssuesBranch =
    load.status === 'delivered_with_issues' || load.deliveryIssueSettledAt !== null;
  const stages = load.postingType === 'own_fleet' ? OWN_FLEET_STAGES : LIFECYCLE_STAGES;
  const path: LoadStatus[] = [];
  for (const stage of stages) {
    if (stage === 'delivered_ok' && tookIssuesBranch) path.push('delivered_with_issues');
    if (stage === 'delivered_with_issues') continue;
    path.push(stage);
  }
  // A cancelled load stops where it was cancelled: the stages it went through, then Cancelled.
  if (load.status === 'cancelled') {
    const reached = load.cancelledFromStage ? path.indexOf(load.cancelledFromStage) : -1;
    return [...path.slice(0, reached + 1), 'cancelled'];
  }
  return path;
}

/** How far along its own stage path the load is, 0–100 — the Home Live Loads progress bar. */
export function progressPercentFor(load: StagePathLoad): number {
  const path = stagePathFor(load);
  const index = path.indexOf(load.status);
  return index < 0 ? 0 : Math.round(((index + 1) / path.length) * 100);
}
