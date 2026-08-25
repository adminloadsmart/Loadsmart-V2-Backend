export interface DriverAnalyticsDateRange {
  from?: string;
  to?: string;
}

export interface DriverAnalyticsHeader {
  id: string;
  fullName: string;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  /** Whole years since dateOfJoining; null if dateOfJoining was never set. */
  yearsExperience: number | null;
  /** The driver's current active/primary vehicle link, if any. */
  currentVehicle: { id: string; registrationNumber: string } | null;
}

export interface DriverAnalyticsTripStats {
  total: number;
  /** Of the delivered subset only — a load still in transit is neither on-time nor late yet. */
  onTime: number;
  late: number;
  onTimePercentage: number | null;
}

export interface DriverAnalyticsTrendPoint {
  /** "YYYY-MM", bucketed by deliveredAt. */
  month: string;
  tripsCount: number;
  onTimePercentage: number | null;
}

export interface DriverAnalyticsOverview {
  driver: DriverAnalyticsHeader;
  trips: DriverAnalyticsTripStats;
  onTimeTrend: DriverAnalyticsTrendPoint[];
}
