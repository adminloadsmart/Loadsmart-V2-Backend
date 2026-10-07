import { z } from 'zod';

export type VehicleImportErrorCode =
  | 'missing_required'
  | 'invalid_format'
  | 'invalid_value'
  | 'out_of_range'
  | 'duplicate_in_file'
  | 'already_exists'
  | 'not_found'
  | 'unknown_field'
  | 'failed';

/** Validator path (under `body`) → sheet column key, for the fields the mapper nests. */
const COLUMN_KEY_BY_PATH: Record<string, string> = {
  'truckType.body': 'truckBody',
  'truckType.wheelCount': 'wheelCount',
  'truckType.axleType': 'axleType',
  'truckType.capacityTons': 'capacityTons',
  'truckType.bodyLengthFt': 'bodyLengthFt',
  'gps.hasGps': 'hasGps',
  'gps.provider': 'gpsProvider',
  'gps.deviceImei': 'gpsDeviceImei',
  'tyres.preset': 'tyrePreset',
  'operationalStatus.operationalStatus': 'operationalStatus',
  'operationalStatus.reason': 'operationalStatusReason',
  'driverLink.driverId': 'driverId',
  'driverLink.isPrimary': 'driverIsPrimary',
  'driverLink.linkedFrom': 'driverLinkedFrom',
};

const DOCUMENT_PREFIX: Record<string, string> = {
  rc: 'rc',
  insurance: 'insurance',
  permit: 'permit',
  puc: 'puc',
  fitness: 'fitness',
  road_tax: 'roadTax',
  rc_front: 'rcFront',
  rc_back: 'rcBack',
};

const DOCUMENT_FIELD_SUFFIX: Record<string, string> = {
  documentNumber: 'Number',
  providerName: '', // insurance only — the sheet column is insuranceProvider
  issueDate: 'IssueDate',
  expiryDate: 'ExpiryDate',
  fileUrl: 'Url',
};

/** Sheet column key a validator issue path points at (e.g. `cost.emiAmount` → `emiAmount`). */
export function columnKeyForPath(
  path: PropertyKey[],
  documents: { documentType?: string }[] | undefined,
): string | undefined {
  const [head, ...rest] = path.map(String);
  if (!head) return undefined;
  if (rest.length === 0) return head;
  if (head === 'documents') {
    const type = documents?.[Number(rest[0])]?.documentType;
    const prefix = type ? DOCUMENT_PREFIX[type] : undefined;
    const field = rest[1];
    if (!prefix) return undefined;
    if (field === 'providerName') return 'insuranceProvider';
    return field && field in DOCUMENT_FIELD_SUFFIX
      ? `${prefix}${DOCUMENT_FIELD_SUFFIX[field]}`
      : undefined;
  }
  const direct = COLUMN_KEY_BY_PATH[`${head}.${rest[0]}`];
  if (direct) return direct;
  // cost / serviceUsage fields keep their flat column name.
  return rest[0];
}

/** "registrationNumber" → "Registration number" — the label used at the start of a message. */
export function labelFor(key: string): string {
  const text = humanize(key);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

const EXPECTED_LABELS: Record<string, string> = {
  number: 'a number',
  string: 'text',
  boolean: 'yes or no',
  int: 'a whole number',
  integer: 'a whole number',
};

/** Turns a zod issue into a sentence a person filling in the sheet can act on. */
export function describeIssue(
  issue: z.core.$ZodIssue,
  label: string,
): { code: VehicleImportErrorCode; message: string } {
  const raw = issue.message;
  switch (issue.code) {
    case 'invalid_type': {
      if (/received undefined/i.test(raw))
        return { code: 'missing_required', message: `${label} is required` };
      const expected = EXPECTED_LABELS[String(issue.expected)] ?? String(issue.expected);
      return { code: 'invalid_format', message: `${label} must be ${expected}` };
    }
    case 'invalid_value': {
      const options = issue.values.map(String).join(', ');
      return { code: 'invalid_value', message: `${label} must be one of: ${options}` };
    }
    case 'too_small':
      return {
        code: 'out_of_range',
        message:
          issue.origin === 'string'
            ? `${label} cannot be empty or shorter than ${issue.minimum} characters`
            : `${label} must be ${issue.inclusive ? 'at least' : 'greater than'} ${issue.minimum}`,
      };
    case 'too_big':
      return {
        code: 'out_of_range',
        message:
          issue.origin === 'string'
            ? `${label} is too long (max ${issue.maximum} characters)`
            : `${label} must be ${issue.inclusive ? 'at most' : 'less than'} ${issue.maximum}`,
      };
    case 'invalid_format':
      return { code: 'invalid_format', message: `${label} is not in a valid format` };
    case 'unrecognized_keys':
      return {
        code: 'unknown_field',
        message: `${label} has unsupported fields: ${issue.keys.join(', ')}`,
      };
    default:
      // Custom refinements already carry a readable sentence (e.g. "Invalid registration number").
      return { code: 'invalid_format', message: raw };
  }
}

/** Maps a service-layer failure (conflict, missing driver, …) to a code plus its own message. */
export function describeServiceError(error: unknown): {
  code: VehicleImportErrorCode;
  message: string;
} {
  if (!(error instanceof Error)) return { code: 'failed', message: 'Failed to onboard vehicle' };
  const name = error.constructor.name;
  if (name === 'ConflictError') return { code: 'already_exists', message: error.message };
  if (name === 'NotFoundError') return { code: 'not_found', message: error.message };
  if (name === 'ValidationError') return { code: 'invalid_value', message: error.message };
  return { code: 'failed', message: error.message || 'Failed to onboard vehicle' };
}

export { humanize };
