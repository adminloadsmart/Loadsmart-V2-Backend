export interface FleetAnalyticsDateRange {
  from?: string;
  to?: string;
}

/** "EMI outgo" tile — current state, not date-range scoped: EMI is a standing monthly
 *  obligation, not a dated ledger entry. */
export interface FleetEmiSummary {
  totalEmiAmount: number;
  vehiclesOnFinance: number;
}

/** "Own vs market mix" donut — counts by Load.sourceType, optionally windowed by createdAt. */
export interface FleetSourceMix {
  ownFleet: number;
  market: number;
}

export interface FleetAnalyticsOverview {
  emiSummary: FleetEmiSummary;
  sourceMix: FleetSourceMix;
}
