import { DriverWithRelation } from '../driver.service';
import { TripListRow } from '../../loads/utils/trip-view';

/**
 * Driver-portal profile screen — everything getDriver/findByIdWithRelations already returns
 * (fullName, phoneNumber, documents, verifications, bankDetails, vehicleLinks, etc., unchanged),
 * plus a handful of new fields aggregated from the assigned vehicle (masters.vehicles/
 * vehicle_documents/truck_types), trip metrics, and the organization's name. Fields with no
 * backing data anywhere in this build (experience, KMs driven, settlement due, and every Settings
 * entry — none of these are tracked server-side yet) are explicit `null`, not omitted, so the
 * driver app can render a consistent "—" placeholder rather than branching on a missing key.
 *
 * `documentStatus` (a derived summary) is deliberately named apart from the entity's own
 * `documents` array (the raw DriverDocumentEntity rows) so neither shadows the other.
 */
export interface DriverProfileView extends DriverWithRelation {
  organizationName: string | null;
  experienceYears: number | null;
  vehicle: {
    registrationNumber: string;
    type: string | null;
    insuranceValidTill: string | null;
    fitnessValidTill: string | null;
  } | null;
  documentStatus: {
    drivingLicence: { uploaded: boolean; verified: boolean } | null;
    identityProof: { uploaded: boolean; verified: boolean } | null;
  };
  performance: {
    tripsCompleted: number | null;
    onTimeDeliveryPercentage: number | null;
    kmsDriven: number | null;
    settlementDue: number | null;
  };
  settings: {
    notificationsEnabled: boolean | null;
    language: string | null;
    locationSharing: string | null;
    appVersion: string | null;
  };
}

/** The screen's filter tabs, mapped to the `driver.<category>.*` type-prefix convention — a
 *  client-facing shorthand, not a stored column. See
 *  notification.repository.ts's listByRecipientAcrossTenants. */
export const NOTIFICATION_TYPE_PREFIXES = {
  jobs: 'driver.job.',
  documents: 'driver.document.',
  settlements: 'driver.settlement.',
  account: 'driver.account.',
} as const;
export type DriverNotificationCategory = keyof typeof NOTIFICATION_TYPE_PREFIXES;

export interface DriverHomeView {
  driver: { driverId: string; fullName: string; vehicleNumber: string | null; phoneNumber: string };
  stats: {
    tripsDone: number;
    onTimePercentage: number | null;
    /** Loads assigned to this driver that aren't 'closed' yet — includes trips still moving and
     *  a 'delivered' trip whose E-POD is pending/rejected review. See loads.types.ts's
     *  OPEN_LOAD_STATUSES. Backs the driver app's "Open Trips" tab. */
    openTrips: number;
  };
  currentJob: TripListRow | null;
  upcomingJobs: TripListRow[];
  unreadNotificationCount: number;
}
