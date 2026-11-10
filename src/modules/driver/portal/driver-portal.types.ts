import { DriverWithRelation } from '../drivers.interface';
import { TripListRow } from '../../loads/utils/trip-view';
import { LoadStatus, PodStatus } from '../../loads/utils/loads.types';
import { NotificationEntity } from '../../notifications/notifications.entity';

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
export interface DriverFleetView {
  tenantId: string;
  organizationName: string | null;
  vehicle: DriverProfileView['vehicle'];
  performance: DriverProfileView['performance'];
}

export interface DriverProfileView extends DriverWithRelation {
  /** One entry per active fleet the driver is linked to. The top-level organizationName/vehicle/
   *  performance below mirror the first (oldest) link, kept for older app builds. */
  fleets: DriverFleetView[];
  /** Signed download URL for the driver's profile photo; null when none is set. */
  profilePhotoUrl?: string | null;
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

/** Where the invite behind a "You've been invited" card stands now. `replaced` — a newer send of
 *  the same invite is the one to act on (each Resend adds a card). */
export const DRIVER_INVITE_CARD_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
  'replaced',
] as const;
export type DriverInviteCardStatus = (typeof DRIVER_INVITE_CARD_STATUSES)[number];

/** Where the E-POD behind an "Upload the E-POD" card stands now. `unavailable` — the load is gone
 *  or no longer this driver's (reassigned), so there's nothing for them to upload. */
export const DRIVER_POD_CARD_STATUSES = [
  'not_uploaded',
  'under_review',
  'accepted',
  'rejected',
  'unavailable',
] as const;
export type DriverPodCardStatus = (typeof DRIVER_POD_CARD_STATUSES)[number];

/** Where the load behind a "New load assigned" / "Loading contact changed" / "Loading point
 *  changed" card stands now (driver/portal/trip-card.ts):
 *  - `active` — still applies;
 *  - `replaced` — the contact/point was changed again (a newer card has the current one);
 *  - `completed` — loading is done (contact/point cards) or the trip is (assigned card);
 *  - `reassigned` — the load is no longer this driver's;
 *  - `unavailable` — the load is gone. */
export const DRIVER_TRIP_CARD_STATUSES = [
  // Most live first — a several-loads card reads the first of these any of its loads has.
  'active',
  'completed',
  'replaced',
  'reassigned',
  'unavailable',
] as const;
export type DriverTripCardStatus = (typeof DRIVER_TRIP_CARD_STATUSES)[number];

/** The few load fields a reminder card's live state is worked out from. */
export interface PodCardLoad {
  id: string;
  tenantId: string;
  code: string;
  driverId: string | null;
  status: LoadStatus;
  podStatus: PodStatus | null;
  podFileKey: string | null;
}

/** How a reminder card names its load: by id (saved since the flag was added), else by the load
 *  code in its message params (older cards) — always within the card's own tenant. */
export interface PodCardLoadRef {
  tenantId: string;
  loadId: string | null;
  loadCode: string | null;
}

/** The few load fields a load card's live state is worked out from. */
export interface TripCardLoad {
  id: string;
  tenantId: string;
  driverId: string | null;
  status: LoadStatus;
  loadingContactName: string | null;
  loadingContactPhone: string | null;
  loadingPointId: string | null;
  loadingPoint: { title: string } | null;
}

/** The loads a card is about (metadata.loadIds — one, or several on a "3 loads assigned" card),
 *  within the card's own tenant. */
export interface TripCardRef {
  tenantId: string;
  loadIds: string[];
}

/** The driver's notification list item — the notification plus, on an invite card, an E-POD
 *  reminder or a load card, its live state. Older cards stay in the list; the flag says whether
 *  to act on it. */
export type DriverNotificationItem = NotificationEntity & {
  /** Null on every notification that isn't an invite card. */
  invitation: {
    invitationId: string;
    status: DriverInviteCardStatus;
    /** Show Accept / Decline — only on the newest send's card, while the invite is pending. */
    actionable: boolean;
  } | null;
  /** Null on every notification that isn't an "Upload the E-POD" reminder (or whose load can't
   *  be identified). */
  pod: {
    loadId: string;
    status: DriverPodCardStatus;
    /** Show "Upload E-POD" — while the driver can upload right now: at the unloading point with
     *  no E-POD yet, or after a rejection with no new copy. Every reminder card follows the load,
     *  so all of them turn off together once the E-POD is in. */
    actionable: boolean;
  } | null;
  /** Null on every notification that isn't a load card (load.assigned /
   *  load.loading_contact_changed / load.loading_point_changed). */
  trip: {
    /** One load, or several on a "3 loads have been assigned to you" card. */
    loadIds: string[];
    /** On a several-loads card: `active` if any of them still is. */
    status: DriverTripCardStatus;
    /** Act on the card (open / start the trip, call the contact, navigate to the point) — only
     *  while `active`. */
    actionable: boolean;
  } | null;
};

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
  /** Backs "142 km left · arriving by 3:10 PM" (tracking-eta.reader.ts). Null while the trip
   *  has none (no route/coordinates) — hide the line. */
  /** Total route length, loading → unloading point, whatever the truck's progress. */
  distanceKm: number | null;
  distanceLeftKm: number | null;
  etaAt: string | null;
  /** True when the last location fix is old, so distanceLeftKm/etaAt are the last known values. */
  etaStale: boolean;
  /** 'live' = truck's latest position → unloading point (Google) once it is in transit to the
   *  drop; 'planned' = loading → unloading distance/time from now, before that. Null when none. */
  etaSource: 'live' | 'planned' | null;
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
