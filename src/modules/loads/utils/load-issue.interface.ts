import { LoadIssueCategory } from './loads.types';

export interface ReportLoadIssueInput {
  category: LoadIssueCategory;
  details?: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  locationCapturedAt: string;
  photoFileKeys?: string[];
}
