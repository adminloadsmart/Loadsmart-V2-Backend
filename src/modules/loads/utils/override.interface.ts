/**
 * A caller's justification for proceeding past an amber (overridable) pre-creation check —
 * Plan Dispatch v2.0's validation catalogue (V-17/R-29/R-30): the reason (≥15 chars) is recorded
 * on the affected requisition/load's audit trail. `checkId` is constrained per-endpoint by that
 * endpoint's own zod schema (requisition.validators.ts: 'C05'; dispatch-planning.validators.ts:
 * 'C03' — the only checks in this catalogue that are ever overridable).
 */
export interface OverrideInput {
  checkId: string;
  reason: string;
}
