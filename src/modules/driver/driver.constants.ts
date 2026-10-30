import { DriverExportColumn, DriverImportColumn } from './drivers.interface';
import {
  DriverEngagementType,
  DriverLicenseEndorsement,
  DriverSalaryType,
  DriverScoreStatus,
  DriverVerificationStatus,
} from './drivers.types';

/**
 * Sarathi's standard driving-licence number, once spaces and hyphens are stripped: 2-letter state
 * code, 2-digit RTO code, 4-digit year of issue, 7-digit serial — e.g. "MH-12 2019 0012345" →
 * "MH1220190012345". Licences in older non-standard state formats don't match and are rejected.
 */
export const DRIVING_LICENCE_REGEX = /^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/;

/** driver_tenant_relations.note is varchar(500). */
export const DRIVER_NOTE_MAX_LENGTH = 500;

/**
 * How long after a rejection a driver's join request can be restored (and is listed in Recently
 * Rejected). Older rejections are only hidden, never deleted.
 */
export const DRIVER_JOIN_REQUEST_RESTORE_DAYS = 30;

/**
 * Once a driver has declined an invite, the fleet may send it this many more times (Resend or
 * invite-by-mobile on the same number); after that this tenant can't invite them again.
 */
export const DRIVER_INVITE_SENDS_AFTER_DECLINE = 1;

/**
 * Once those sends are used, the fleet may send once more this many days after the driver's latest
 * decline or the latest send, whichever is later — at most one send per this many days from then
 * on. The driver can always ask to join the fleet themselves meanwhile.
 */
export const DRIVER_INVITE_COOL_OFF_DAYS = 30;

/** The driver's "You've been invited" notification — one per send of the invite, each carrying
 *  the invitationId in its metadata. */
export const DRIVER_INVITED_NOTIFICATION_TYPE = 'driver.account.invited';

/** HMAC purpose of the invite WhatsApp's tracked-link token (utils/invite-link-token.ts) — keeps
 *  its signatures from matching any other use of the same secret. */
export const DRIVER_INVITE_LINK_TOKEN_PURPOSE = 'driver-invite-link';

/** Characters of the token's base64url HMAC kept in the link (22 ≈ 128 bits). */
export const DRIVER_INVITE_LINK_SIGNATURE_LENGTH = 22;

/** Per-IP throttle on the public tracked-link endpoint (GET /driver-invites/open/:token). */
export const DRIVER_INVITE_LINK_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

/** A driver's score only means something after this many trips — until then they read as `new`. */
export const MIN_SCORED_TRIPS = 5;

/* Bulk driver upload (driver-import.mapper.ts / driver-import.service.ts). */

/**
 * Lower than the vehicle import's 1000: every row costs a paid Sarathi lookup that can poll for
 * ~15s, and the preview waits for all of them before responding.
 */
export const DRIVER_IMPORT_MAX_ROWS = 100;

/**
 * One column per flattened onboardDriver field, in sheet order. Licence photos (`documents`) are
 * left out — they are uploaded files, not something a sheet cell can carry.
 */
export const DRIVER_IMPORT_COLUMNS: DriverImportColumn[] = [
  { key: 'fullName' },
  { key: 'phoneNumber' },
  { key: 'licenseNumber' },
  { key: 'dateOfBirth' },
  { key: 'licenseExpiry' },
  { key: 'dateOfJoining' },
  { key: 'bloodGroup', aliases: ['blood'] },
  { key: 'addressLine1' },
  { key: 'addressLine2' },
  { key: 'city' },
  { key: 'pinCode' },
  { key: 'emergencyContactName' },
  { key: 'emergencyContactPhone' },
  { key: 'emergencyContactRelation' },
  { key: 'salaryType' },
  // How much, in the unit salaryType names — per month for `fixed`, per trip, or per km.
  { key: 'salaryAmount', aliases: ['monthlySalary', 'salary', 'pay'] },
  { key: 'engagementType' },
  { key: 'bhattaPerDay', aliases: ['bhatta', 'bhattaPerDayPerTrip', 'dailyBhatta'] },
  { key: 'advanceOutstanding' },
  { key: 'homeBase' },
  { key: 'licenseEndorsements' },
  { key: 'hasHealthInsurance', aliases: ['healthInsurance'] },
  { key: 'hasLifeInsurance', aliases: ['lifeInsurance'] },
  { key: 'bankAccountNumber' },
  { key: 'bankIfsc' },
  { key: 'bankAccountHolderName' },
  { key: 'bankUpiId' },
  { key: 'operationalStatus' },
  { key: 'operationalStatusReason' },
  // This fleet's own note about the driver (max 500 characters).
  { key: 'note', aliases: ['notes', 'remarks', 'comment'] },
];

/** Number-valued columns — "22,000" becomes 22000. */
export const DRIVER_IMPORT_NUMERIC_COLUMNS = new Set([
  'salaryAmount',
  'bhattaPerDay',
  'advanceOutstanding',
]);

/** Enum-valued columns — "On Roll" / "per-trip" / "Don't know" become `on_roll` / `per_trip` / `dont_know`. */
export const DRIVER_IMPORT_ENUM_COLUMNS = new Set([
  'salaryType',
  'engagementType',
  'hasHealthInsurance',
  'hasLifeInsurance',
  'operationalStatus',
]);

/** Comma-separated cells that become arrays, e.g. "hazmat" → ['hazmat']. */
export const DRIVER_IMPORT_LIST_COLUMNS = new Set(['licenseEndorsements']);

/** Parallel Sarathi lookups (preview) and onboards (save) — each can poll IDfy for ~15s. */
export const DRIVER_IMPORT_CONCURRENCY = 5;

/** onboardDriver's `bankDetails` fields → the flat sheet column each came from. */
export const DRIVER_IMPORT_BANK_COLUMN_BY_FIELD: Record<string, string> = {
  accountNumber: 'bankAccountNumber',
  ifsc: 'bankIfsc',
  accountHolderName: 'bankAccountHolderName',
  upiId: 'bankUpiId',
};

/* Roster export (driver-export.mapper.ts) — GET /drivers/export. */

/** Same cap as the vehicle export. */
export const DRIVER_EXPORT_MAX_ROWS = 5000;

/** Sheet columns, in order — the roster's own columns, readable rather than import-shaped. */
export const DRIVER_EXPORT_COLUMNS: DriverExportColumn[] = [
  // Profile
  { key: 'fullName', header: 'Full Name' },
  { key: 'mobileNumber', header: 'Mobile Number' },
  { key: 'dateOfBirth', header: 'Date of Birth' },
  { key: 'address', header: 'Address' },
  { key: 'city', header: 'City' },
  { key: 'pinCode', header: 'PIN Code' },
  // Licence credentials
  { key: 'licenceNumber', header: 'Licence Number' },
  { key: 'licenceClass', header: 'Licence Class' },
  { key: 'licenceEndorsements', header: 'Endorsements' },
  { key: 'licenceValidTo', header: 'Licence Valid To' },
  { key: 'licenceDaysLeft', header: 'Licence Days Left' },
  { key: 'sarathiVerification', header: 'Sarathi Verification' },
  { key: 'sarathiCheckedOn', header: 'Sarathi Checked On' },
  { key: 'eligibleToDrive', header: 'Eligible to Drive' },
  // Contact & engagement
  { key: 'bloodGroup', header: 'Blood Group' },
  { key: 'emergencyContactName', header: 'Emergency Contact Name' },
  { key: 'emergencyContactPhone', header: 'Emergency Contact Phone' },
  { key: 'emergencyContactRelation', header: 'Emergency Contact Relation' },
  { key: 'engagementType', header: 'Engagement Type' },
  { key: 'dateOfJoining', header: 'Date of Joining' },
  { key: 'tenureYears', header: 'Tenure (Years)' },
  { key: 'payType', header: 'Pay Type' },
  { key: 'payAmount', header: 'Pay Amount' },
  { key: 'bhattaPerDay', header: 'Bhatta per Day' },
  { key: 'advanceOutstanding', header: 'Advance Outstanding' },
  // Assignment
  { key: 'assignedVehicle', header: 'Assigned Vehicle' },
  { key: 'truckType', header: 'Truck Type' },
  { key: 'homeBase', header: 'Home Base' },
  // Availability
  { key: 'availability', header: 'Availability' },
  { key: 'availabilityReason', header: 'Availability Reason' },
  { key: 'currentLoad', header: 'Current Load' },
  // Performance
  { key: 'trips', header: 'Trips' },
  { key: 'onTimePercentage', header: 'On-Time %' },
  { key: 'driverScore', header: 'Driver Score' },
  // App
  { key: 'driverAppInstalled', header: 'Driver App Installed' },
  { key: 'appLastSeen', header: 'App Last Seen' },
  { key: 'note', header: 'Note' },
];

/** Engagement as the Add-a-driver form labels it. */
export const DRIVER_ENGAGEMENT_TYPE_LABELS: Record<DriverEngagementType, string> = {
  on_roll: 'On-roll Salaried',
  per_trip: 'Per Trip',
  vendor: "Vendor's Driver",
};

/** How the driver is paid; Pay Amount is per month, per trip or per km accordingly. */
export const DRIVER_SALARY_TYPE_LABELS: Record<DriverSalaryType, string> = {
  fixed: 'Fixed Monthly',
  per_trip: 'Per Trip',
  per_km: 'Per Km',
};

/** The roster's availability split, as the export's Availability column writes it. */
export const DRIVER_EXPORT_AVAILABILITY_LABELS = {
  left_company: 'Left Company',
  on_trip: 'On Trip',
  not_available: 'Not Available',
  available: 'Available',
} as const;

/** Latest Sarathi DL check, as the export writes it; DRIVER_EXPORT_NOT_CHECKED when never run. */
export const DRIVER_VERIFICATION_STATUS_LABELS: Record<DriverVerificationStatus, string> = {
  pending: 'Pending',
  verified: 'Verified',
  not_found: 'Not Found',
  manual_review: 'Manual Review',
};
export const DRIVER_EXPORT_NOT_CHECKED = 'Not Checked';

export const DRIVER_LICENSE_ENDORSEMENT_LABELS: Record<DriverLicenseEndorsement, string> = {
  hazmat: 'Hazmat',
};

/** How the export writes a yes/no column. */
export const DRIVER_EXPORT_BOOLEAN_LABELS = { true: 'Yes', false: 'No' } as const;

/** Score badge text — what the export writes while a driver has no numeric score. */
export const DRIVER_SCORE_STATUS_LABELS: Record<DriverScoreStatus, string> = {
  new: 'New',
  strong: 'Strong',
  watch: 'Watch',
};

/** Sarathi class-of-vehicle codes → the name the licence card shows ("HTV · Heavy Transport
 *  Vehicle"). A code not listed shows on its own. */
export const DRIVER_LICENCE_CLASS_LABELS: Record<string, string> = {
  TRANS: 'Transport Vehicle',
  HTV: 'Heavy Transport Vehicle',
  HGMV: 'Heavy Goods Motor Vehicle',
  HMV: 'Heavy Motor Vehicle',
  HPMV: 'Heavy Passenger Motor Vehicle',
  MGV: 'Medium Goods Vehicle',
  MPMV: 'Medium Passenger Motor Vehicle',
  LMV: 'Light Motor Vehicle',
  MCWG: 'Motorcycle with Gear',
  MCWOG: 'Motorcycle without Gear',
};

/** Daily job (00:05 India) that sets drivers whose "fit to drive again from" date has come back to
 *  Available. Runs on the notification-schedules queue — the app's one cron scheduler. */
export const DRIVER_AVAILABILITY_RETURN_JOB = 'driver-availability-return';
export const DRIVER_AVAILABILITY_RETURN_CRON = '5 0 * * *';
export const DRIVER_AVAILABILITY_RETURN_TIME_ZONE = 'Asia/Kolkata';
