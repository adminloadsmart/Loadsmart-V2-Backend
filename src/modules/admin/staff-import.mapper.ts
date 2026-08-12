import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { StaffImportMapping } from './staff-import.types';

export const STAFF_IMPORT_FIELDS = [
  'fullName',
  'phoneNumber',
  'email',
  'role',
  'coverage',
] as const;
const roleAliases: Record<string, string> = {
  'sales executive': 'sales',
  salesperson: 'sales',
  'online kyc': 'online_kyc_desk',
  'offline kyc': 'offline_kyc_desk',
  'load console': 'load_console',
};
const aliases: Record<(typeof STAFF_IMPORT_FIELDS)[number], string[]> = {
  fullName: [
    'name',
    'full name',
    'fullname',
    'user name',
    'employee name',
    'staff name',
    'customer name',
    'contact name',
  ],
  phoneNumber: [
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'mobile no',
    'contact number',
    'telephone',
    'phone no',
  ],
  email: ['email', 'email address', 'mail', 'e mail'],
  role: ['role', 'designation', 'user role', 'staff role', 'employee role', 'type'],
  coverage: ['coverage', 'region', 'territory', 'city', 'location', 'assigned area'],
};

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\uFEFF]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectMapping(headers: string[]): {
  mapping?: StaffImportMapping;
  suggestions: Record<string, string>;
  missing: string[];
  ambiguous: string[];
} {
  const normalized = new Map(headers.map((header) => [header, normalizeHeader(header)]));
  const suggestions: Record<string, string> = {};
  const ambiguous: string[] = [];
  for (const field of STAFF_IMPORT_FIELDS) {
    const matches = headers.filter((header) => {
      const value = normalized.get(header)!;
      return value === normalizeHeader(field) || aliases[field].includes(value);
    });
    if (matches.length === 1) suggestions[field] = matches[0];
    else if (matches.length > 1) ambiguous.push(field);
  }
  const missing = STAFF_IMPORT_FIELDS.filter((field) => !suggestions[field]);
  if (missing.length || ambiguous.length) return { suggestions, missing, ambiguous };
  return { mapping: suggestions as unknown as StaffImportMapping, suggestions, missing, ambiguous };
}

export function normalizeStaffRow(
  row: Record<string, string>,
  mapping: StaffImportMapping,
): Record<string, string> {
  const rawRole = row[mapping.role]?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const role = roleAliases[rawRole] ?? rawRole.replace(/\s+/g, '_');
  return {
    fullName: row[mapping.fullName]?.trim().replace(/\s+/g, ' ') ?? '',
    phoneNumber: normalizePhoneNumber(row[mapping.phoneNumber] ?? ''),
    email: row[mapping.email]?.trim().toLowerCase() ?? '',
    role,
    coverage: row[mapping.coverage]?.trim().replace(/\s+/g, ' ') ?? '',
  };
}
