import { LoadIssueCategory } from './loads.types';

export interface ReportLoadIssueInput {
  category: LoadIssueCategory;
  details?: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  locationCapturedAt: string;
  photoFileKeys?: string[];
  /** Expected delay this problem causes, in minutes (LS_N_0037). */
  etaImpactMinutes?: number;
}
