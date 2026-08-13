/** Raw `req.query` shape for the fleet-activity endpoint, validated by dashboards.validators.ts. */
export interface FleetActivityRangeInput {
  from?: string;
  to?: string;
}

export interface FleetActivityDateRange {
  from: string;
  to: string;
}

/** Live counts by VehicleOperationalStatus (masters/utils/vehicle.type.ts), not scoped to `range`. */
export interface FleetOperationalBreakdown {
  onTrip: number;
  idle: number;
  warnOnAssign: number;
  inactive: number;
}

export interface FleetActivitySummary {
  range: FleetActivityDateRange;
  fleetSize: number;
  trucksRunningNow: number;
  operationalBreakdown: FleetOperationalBreakdown;
  /**
   * Not computable yet: `tracking`, `maintenance`, and `payments` are still schema-less stubs
   * (no dated distance/cost/earning records — see each module's entity/service files). Revisit
   * once those modules have real data to aggregate over `range`.
   */
  kmCovered: null;
  maintenanceCost: null;
  fleetPnl: null;
}

export type PendingApprovalType = 'customer' | 'vehicle' | 'driver';

/** One row per pending customer/vehicle/driver, normalized to a common shape for Settings →
 *  Approvals — approve/reject still happen on each type's own endpoint (PATCH /customers/{id}/
 *  approve|reject, PATCH /masters/vehicles|drivers/{id}/approve|reject); this is read-only. */
export interface PendingApprovalItem {
  type: PendingApprovalType;
  id: string;
  label: string;
  requestedBy: string | null;
  requestedAt: Date;
}

export interface ListPendingApprovalsResult {
  items: PendingApprovalItem[];
  total: number;
}
