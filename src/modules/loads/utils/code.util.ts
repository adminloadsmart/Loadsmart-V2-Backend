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

const CUSTOMER_CODE_OFFSET = 1000;

/** `CUS-nnnn` — tenant-wide customer display code, same offset scheme as REQ/LOAD. */
export function formatCustomerCode(sequenceValue: number): string {
  return `CUS-${CUSTOMER_CODE_OFFSET + sequenceValue}`;
}

const TRANSPORTER_CODE_OFFSET = 1000;

/** `TRP-nnnn` — tenant-wide transporter display code, same offset scheme as CUS. */
export function formatTransporterCode(sequenceValue: number): string {
  return `TRP-${TRANSPORTER_CODE_OFFSET + sequenceValue}`;
}

const LR_CODE_OFFSET = 1000;

/** `LR-nnnn` — tenant-wide e-LR number (loads/elr/). LR numbers are statutory and never repeat
 *  (C-04), which a per-tenant sequence guarantees. */
export function formatLrNumber(sequenceValue: number): string {
  return `LR-${LR_CODE_OFFSET + sequenceValue}`;
}
