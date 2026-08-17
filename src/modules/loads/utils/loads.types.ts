/**
 * Load module value sets — each declared once as a `const` tuple, same pattern as
 * masters/utils/vehicle.type.ts, so the entity's `@Column({ enum: [...] })`, validators and
 * services can never drift apart.
 */

export const REQUISITION_STATUSES = ['open', 'fully_dispatched', 'closed'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const LOAD_SOURCE_TYPES = ['own_fleet', 'market'] as const;
export type LoadSourceType = (typeof LOAD_SOURCE_TYPES)[number];

export const FREIGHT_TYPES = ['per_ton', 'flat'] as const;
export type FreightType = (typeof FREIGHT_TYPES)[number];

/**
 * The load's single, unified movement status — Advance/Balance payment are tracked
 * separately (LoadEntity.advancePaidAt/balancePaidAt) since they run in
 * parallel with movement rather than block it; see loads/entities/load.entity.ts's doc comment.
 *
 * Order is significant: LoadService.updateStatus walks this array by index to reject skipping
 * ahead or moving backward through the manual tracking stages.
 */
export const LOAD_STATUSES = [
  'created',
  'assigned',
  'loading_confirmed',
  'at_plant',
  'in_transit',
  'reached_delivery_point',
  'delivered',
  'closed',
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/** The subset of LOAD_STATUSES settable via PATCH /loads/:id/status (manual tracking —
 *  this build has no GPS/geofence automation).
 *  'delivered' is only reachable via uploadPod(); 'closed' only via the payment/POD flows. */
export const MANUAL_TRACKING_STATUSES = [
  'at_plant',
  'in_transit',
  'reached_delivery_point',
] as const;
export type ManualTrackingStatus = (typeof MANUAL_TRACKING_STATUSES)[number];

export const LOAD_ACTIVITY_ACTIONS = [
  'LOAD_CREATED',
  'STATUS_CHANGED',
  'DOCUMENT_UPLOADED',
  'PAYMENT_RECORDED',
] as const;
export type LoadActivityAction = (typeof LOAD_ACTIVITY_ACTIONS)[number];

export const LOAD_PAYMENT_TYPES = ['advance', 'balance'] as const;
export type LoadPaymentType = (typeof LOAD_PAYMENT_TYPES)[number];
