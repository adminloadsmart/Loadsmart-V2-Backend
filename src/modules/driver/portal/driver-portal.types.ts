import { DriverWithRelation } from '../driver.service';
import { TripListRow } from '../../loads/utils/trip-view';
import { LoadStatus } from '../../loads/utils/loads.types';

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

/** Home-screen "current trip" card — a display-ready projection of `currentJob`, so the app
 *  doesn't have to stitch route/organization/directions together from a TripListRow. */
export interface DriverHomeCurrentTrip {
  id: string;
  /** Display code, e.g. `LOAD-0552`. */
  code: string;
  status: LoadStatus;
  /** The fleet/organization the driver is working for — the card's top-left chip. */
  organizationName: string | null;
  origin: { title: string; city: string } | null;
  destination: { location: string; city: string | null } | null;
  /** Backs "142 km left · arriving by 3:10 PM". Always null for now — no live tracking/ETA
   *  source or delivery-point coordinates exist yet; the app should hide the line when null. */
  distanceLeftKm: number | null;
  etaAt: string | null;
  /** "Open directions" — destination address for a maps deep link until coordinates exist. */
  directionsQuery: string | null;
}

/** Home-screen "next trip" row — the soonest upcoming assigned load. */
export interface DriverHomeNextTrip {
  id: string;
  code: string;
  organizationName: string | null;
  origin: { title: string; city: string } | null;
  destination: { location: string; city: string | null } | null;
  /** ISO date (YYYY-MM-DD) of the requisition's pickup. Date-only — no pickup time-of-day is
   *  stored, so "tomorrow 7 AM" can only render the day part. */
  pickupDate: string | null;
}

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
  currentTrip: DriverHomeCurrentTrip | null;
  nextTrip: DriverHomeNextTrip | null;
  /** "Money" card. `cashHeld` is null until driver expenses/cash-advance tracking exists. */
  money: { cashHeld: string | null; organizationName: string | null };
  unreadNotificationCount: number;
}
