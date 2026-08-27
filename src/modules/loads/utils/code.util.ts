/**
 * Human-readable display codes — Plan Dispatch v2.0's `REQ-nnnn` (requisition) and `REQ-nnnn-Lx`
 * (load, one per truck) — layered on top of the UUID primary keys everything else in this module
 * still uses for FKs/lookups. Values come from CodeSequenceRepository.next, scoped per tenant
 * (requisition codes) or per requisition (load codes, restarting at 1 each time).
 */

const REQUISITION_CODE_OFFSET = 1000;

export function formatRequisitionCode(sequenceValue: number): string {
  return `REQ-${REQUISITION_CODE_OFFSET + sequenceValue}`;
}

export function formatLoadCode(requisitionCode: string, sequenceValue: number): string {
  return `${requisitionCode}-L${sequenceValue}`;
}
