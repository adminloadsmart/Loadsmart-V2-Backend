import { DriverImportColumn } from './drivers.interface';

/**
 * Sarathi's standard driving-licence number, once spaces and hyphens are stripped: 2-letter state
 * code, 2-digit RTO code, 4-digit year of issue, 7-digit serial — e.g. "MH-12 2019 0012345" →
 * "MH1220190012345". Licences in older non-standard state formats don't match and are rejected.
 */
export const DRIVING_LICENCE_REGEX = /^[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}$/;

/** driver_tenant_relations.note is varchar(500). */
export const DRIVER_NOTE_MAX_LENGTH = 500;

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
  { key: 'fullName', example: 'Ramesh Kumar' },
  { key: 'phoneNumber', example: '9876543210' },
  { key: 'licenseNumber', example: 'MH1220190012345' },
  { key: 'dateOfBirth', example: '1988-04-12' },
  { key: 'licenseExpiry', example: '2032-04-11' },
  { key: 'dateOfJoining', example: '2026-01-05' },
  { key: 'bloodGroup', example: 'B+', aliases: ['blood'] },
  { key: 'addressLine1', example: '12 Transport Nagar' },
  { key: 'addressLine2' },
  { key: 'city', example: 'Pune' },
  { key: 'pinCode', example: '411001' },
  { key: 'emergencyContactName', example: 'Sunita Kumar' },
  { key: 'emergencyContactPhone', example: '9876500000' },
  { key: 'emergencyContactRelation', example: 'Wife' },
  { key: 'salaryType', example: 'fixed' },
  // How much, in the unit salaryType names — per month for `fixed`, per trip, or per km.
  { key: 'salaryAmount', example: 22000, aliases: ['monthlySalary', 'salary', 'pay'] },
  { key: 'engagementType', example: 'on_roll' },
  { key: 'bhattaPerDay', example: 300, aliases: ['bhatta', 'bhattaPerDayPerTrip', 'dailyBhatta'] },
  { key: 'advanceOutstanding', example: 0 },
  { key: 'homeBase', example: 'Pune' },
  { key: 'licenseEndorsements', example: 'hazmat' },
  { key: 'hasHealthInsurance', example: 'yes', aliases: ['healthInsurance'] },
  { key: 'hasLifeInsurance', example: 'no', aliases: ['lifeInsurance'] },
  { key: 'bankAccountNumber', example: '123456789012' },
  { key: 'bankIfsc', example: 'HDFC0001234' },
  { key: 'bankAccountHolderName', example: 'Ramesh Kumar' },
  { key: 'bankUpiId', example: 'ramesh@okhdfc' },
  { key: 'operationalStatus', example: 'active' },
  { key: 'operationalStatusReason' },
  // This fleet's own note about the driver (max 500 characters).
  { key: 'note', example: 'Prefers night runs', aliases: ['notes', 'remarks', 'comment'] },
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
