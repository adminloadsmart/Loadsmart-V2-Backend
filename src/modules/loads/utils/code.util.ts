/**
 * Human-readable display codes — `REQ-nnnn` (requisition) and `LOAD-nnnn` (load, one per truck)
 * — layered on top of the UUID primary keys everything else in this module still uses for FKs/
 * lookups. Both are independent, tenant-wide sequential counters (CodeSequenceRepository.next,
 * scoped per tenant) — a load's code carries no relationship to its parent requisition's code,
 * by design.
 */

const REQUISITION_CODE_OFFSET = 1000;
const LOAD_CODE_OFFSET = 1000;

export function formatRequisitionCode(sequenceValue: number): string {
  return `REQ-${REQUISITION_CODE_OFFSET + sequenceValue}`;
}

export function formatLoadCode(sequenceValue: number): string {
  return `LOAD-${LOAD_CODE_OFFSET + sequenceValue}`;
}
