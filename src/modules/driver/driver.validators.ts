import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../shared/utils/date';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { IFSC_REGEX } from '../masters/masters.constants';
import { DRIVING_LICENCE_REGEX } from './driver.constants';
import {
  DRIVER_BANK_VERIFICATION_STATUSES,
  DRIVER_BLOOD_GROUPS,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_DOCUMENT_VERIFICATION_SOURCES,
  DRIVER_ENGAGEMENT_TYPES,
  DRIVER_INSURANCE_ANSWERS,
  DRIVER_LICENCE_CLASS_FILTERS,
  DRIVER_LICENCE_VALIDITY_FILTERS,
  DRIVER_ROSTER_EMPLOYMENT_FILTERS,
  DRIVER_SCORE_STATUSES,
  DRIVER_INVITATION_STATUSES,
  DRIVER_LICENSE_ENDORSEMENTS,
  DRIVER_OPERATIONAL_STATUSES,
  DRIVER_ROSTER_SEGMENTS,
  DRIVER_SALARY_TYPES,
  DRIVER_TENANT_RELATION_INITIATORS,
  DRIVER_TENANT_RELATION_STATUSES,
  DRIVER_VERIFICATION_STATUSES,
  DRIVER_VERIFICATION_TYPES,
} from './drivers.types';

const uuid = z.string().uuid();

/** "a,b,c" → ['a', 'b', 'c'], each checked against `values` and de-duplicated. */
const csvList = <T extends readonly [string, ...string[]]>(
  values: T,
  normalise: (value: string) => string = (value) => value,
) =>
  z
    .string()
    .transform((raw) => [
      ...new Set(
        raw
          .split(',')
          .map((part) => normalise(part.trim()))
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.enum(values)).min(1));

/** Query-string yes/no: "true" | "false" → boolean. */
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
/** Full timestamp, unlike `isoDate` — used where a moment rather than a day is meant. */
const isoDateTime = z.iso.datetime();

const driverParams = z.object({ driverId: uuid });
// An invitation is its driver_tenant_relations row — a driver can have several for one tenant
// (older declined invites plus the current one), so invitation routes key on this, not driverId.
const invitationParams = z.object({ invitationId: uuid });
const driverDocumentParams = z.object({ driverId: uuid, documentId: uuid });
const driverBankDetailsParams = z.object({
  driverId: uuid,
  bankDetailsId: uuid,
});

/**
 * Licence numbers are typed as printed — "MH-12 2019 0012345" — so strip spaces/hyphens and
 * uppercase before checking the Sarathi format. Without the normalisation the same licence stores
 * two ways and the tenant-unique index cannot catch the duplicate. Shared with the driver app's
 * validators so both sides accept exactly the same numbers.
 */
export const licenseNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]+/g, '').toUpperCase())
  .refine((value) => DRIVING_LICENCE_REGEX.test(value), 'Invalid driving licence number');

/**
 * Section-1 fields of `onboardDriver`. Mirrors what the driver app's own /register requires —
 * licenseNumber + dateOfBirth mandatory — so a staff-created profile is a usable app account.
 * fullName is optional: the server takes it from the Sarathi lookup and only needs this one when
 * the lookup returns no name (see DriverService.onboardDriver).
 */
const driverCoreFields = {
  fullName: z.string().trim().min(1).max(150).optional(),
  phoneNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number'),
  licenseNumber,
  licenseExpiry: isoDate.optional(),
  dateOfJoining: isoDate.optional(),
  dateOfBirth: isoDate,
  bloodGroup: z.enum(DRIVER_BLOOD_GROUPS).optional(),
  addressLine1: z.string().min(1).max(255).optional(),
  addressLine2: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  pinCode: z
    .string()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
    .optional(),
  emergencyContactName: z.string().min(1).max(150).optional(),
  emergencyContactPhone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number')
    .optional(),
  salaryType: z.enum(DRIVER_SALARY_TYPES).optional(),
  salaryAmount: z.number().nonnegative().max(9999999999).optional(),
  // "Brother", "Wife", ... — drivers.emergency_contact_relation is varchar(50).
  emergencyContactRelation: z.string().trim().min(1).max(50).optional(),
  engagementType: z.enum(DRIVER_ENGAGEMENT_TYPES).optional(),
  bhattaPerDay: z.number().nonnegative().max(9999999999).optional(),
  advanceOutstanding: z.number().nonnegative().max(9999999999).optional(),
  // drivers.home_base is varchar(150).
  homeBase: z.string().trim().min(1).max(150).optional(),
  licenseEndorsements: z
    .array(z.enum(DRIVER_LICENSE_ENDORSEMENTS))
    .transform((codes) => [...new Set(codes)])
    .optional(),
  // Same yes | no | dont_know answers as the driver app's insurance screen.
  hasHealthInsurance: z.enum(DRIVER_INSURANCE_ANSWERS).optional(),
  hasLifeInsurance: z.enum(DRIVER_INSURANCE_ANSWERS).optional(),
};

/** dateOfBirth is required here (unlike driverCoreFields) — IDfy's verify_with_source rejects a
 * driving-licence lookup without it, so there's no point accepting the call without one. */
const driverVerifyDlBody = z.object({
  licenseNumber,
  dateOfBirth: isoDate,
});

const driverVerificationBody = z.object({
  verificationType: z.enum(DRIVER_VERIFICATION_TYPES),
  verificationStatus: z.enum(DRIVER_VERIFICATION_STATUSES),
  sourceReference: z.string().min(1).max(100).optional(),
  holderName: z.string().min(1).max(150).optional(),
  licenseNumber: licenseNumber.optional(),
  validUntil: isoDate.optional(),
  licenseClass: z.string().min(1).max(100).optional(),
  licenseStatus: z.string().min(1).max(150).optional(),
  addressLine1: z.string().min(1).max(255).optional(),
  addressLine2: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  pinCode: z
    .string()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
    .optional(),
  rawResponse: z.record(z.string(), z.unknown()).optional(),
});

// Fields IDfy needs to check an account — shared by every bank-account preflight endpoint.
export const bankAccountCheckBody = z.object({
  accountNumber: z.string().min(6).max(30),
  ifsc: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code'),
});

export const driverBankDetailsBody = z.object({
  accountNumber: z.string().min(6).max(30),
  ifsc: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code'),
  accountHolderName: z.string().min(1).max(150).optional(),
  upiId: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => /^[a-z0-9.\-_]{2,50}@[a-z]{2,50}$/.test(value), 'Invalid UPI id')
    .optional(),
});

const driverDocumentBody = z.object({
  documentType: z.enum(DRIVER_DOCUMENT_TYPES),
  // The storage `key` from a confirmed POST /files upload (purpose `masters/driver`), not an
  // arbitrary URL — driver.service.ts's assertDriverDlUpload rejects anything else.
  fileUrl: z.string().min(1),
  // Aadhaar/PAN number — only meaningful for those document types, but not worth a refine to
  // enforce that; the field is simply ignored for licence-photo documents.
  documentNumber: z.string().min(1).max(50).optional(),
  verificationSource: z.enum(DRIVER_DOCUMENT_VERIFICATION_SOURCES).optional(),
});

const driverOperationalStatusBody = z.object({
  operationalStatus: z.enum(DRIVER_OPERATIONAL_STATUSES),
  reason: z.string().min(1).max(500).optional(),
  effectiveAt: isoDateTime.optional(),
});

export const driverValidators = {
  /**
   * Preflight check for step 2 of "Add a driver", before the driver exists — no driverId param.
   */
  verifyDriverDl: z.object({ body: driverVerifyDlBody }),

  /** Bank-account preflight for the "Add a driver" form — nothing is saved. */
  verifyDriverBankAccount: z.object({ body: bankAccountCheckBody }),

  /** The whole "Add a driver" form in one request. */
  onboardDriver: z.object({
    body: z.object({
      ...driverCoreFields,
      verification: driverVerificationBody.optional(),
      bankDetails: driverBankDetailsBody.optional(),
      documents: z.array(driverDocumentBody).max(10).optional(),
      operationalStatus: driverOperationalStatusBody.optional(),
    }),
  }),
  listDrivers: z.object({
    // Filter panel lists arrive as one comma-separated string each ("fixed,vendor"); yes/no keys
    // as "true"/"false". A key is simply absent when nothing in its section is ticked.
    query: pagination.extend({
      employmentType: csvList(DRIVER_ROSTER_EMPLOYMENT_FILTERS).optional(),
      licenceValidity: csvList(DRIVER_LICENCE_VALIDITY_FILTERS).optional(),
      licenceClass: csvList(DRIVER_LICENCE_CLASS_FILTERS, (value) =>
        value.toUpperCase(),
      ).optional(),
      hazmatEndorsed: booleanString.optional(),
      scoreStatus: csvList(DRIVER_SCORE_STATUSES).optional(),
      appInstalled: booleanString.optional(),
      status: z.enum(DRIVER_TENANT_RELATION_STATUSES).optional(),
      // e.g. "Invitations Sent" = status=pending_driver_review&initiatedBy=fleet_owner
      initiatedBy: z.enum(DRIVER_TENANT_RELATION_INITIATORS).optional(),
      operationalStatus: z.enum(DRIVER_OPERATIONAL_STATUSES).optional(),
      segment: z.enum(DRIVER_ROSTER_SEGMENTS).optional(),
    }),
  }),
  getDriver: z.object({ params: driverParams }),
  updateDriver: z.object({
    params: driverParams,
    body: z
      .object({
        fullName: z.string().min(1).max(150).optional(),
        phoneNumber: driverCoreFields.phoneNumber.optional(),
        licenseNumber: licenseNumber.optional(),
        licenseExpiry: isoDate.optional(),
        dateOfJoining: isoDate.optional(),
        dateOfBirth: isoDate.optional(),
        bloodGroup: z.enum(DRIVER_BLOOD_GROUPS).optional(),
        addressLine1: z.string().min(1).max(255).optional(),
        addressLine2: z.string().min(1).max(255).optional(),
        city: z.string().min(1).max(100).optional(),
        pinCode: z
          .string()
          .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
          .optional(),
        emergencyContactName: z.string().min(1).max(150).optional(),
        emergencyContactPhone: z
          .string()
          .trim()
          .transform((value) => value.replace(/[\s-]/g, ''))
          .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number')
          .optional(),
        salaryType: z.enum(DRIVER_SALARY_TYPES).optional(),
        salaryAmount: z.number().nonnegative().max(9999999999).optional(),
        emergencyContactRelation: driverCoreFields.emergencyContactRelation,
        engagementType: driverCoreFields.engagementType,
        bhattaPerDay: driverCoreFields.bhattaPerDay,
        advanceOutstanding: driverCoreFields.advanceOutstanding,
        homeBase: driverCoreFields.homeBase,
        licenseEndorsements: driverCoreFields.licenseEndorsements,
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  deleteDriver: z.object({ params: driverParams }),
  approveDriver: z.object({ params: driverParams }),
  rejectDriver: z.object({
    params: driverParams,
    // Optional — the "Requests to You" screen rejects in one click with no reason prompt. Defaulted
    // because Express 5 leaves req.body undefined when the request has no body at all.
    body: z.object({ reason: z.string().trim().min(1).optional() }).default({}),
  }),

  listJoinRequests: z.object({ query: pagination }),

  listInvitations: z.object({
    // Mobile number only — names aren't unique. Partial numbers match ("98720" finds every
    // invite whose mobile contains it); spaces, hyphens and a leading + are ignored.
    query: pagination.omit({ search: true }).extend({
      status: z.enum(DRIVER_INVITATION_STATUSES).optional(),
      phoneNumber: z
        .string()
        .trim()
        .transform((value) => value.replace(/[\s+-]/g, ''))
        .refine((value) => /^\d{3,15}$/.test(value), 'Expected 3-15 digits of a mobile number')
        .optional(),
    }),
  }),
  inviteDriverByPhone: z.object({
    body: z.object({ phoneNumber: driverCoreFields.phoneNumber }),
  }),
  getInvitation: z.object({ params: invitationParams }),
  resendInvitation: z.object({ params: invitationParams }),
  cancelInvitation: z.object({ params: invitationParams }),

  addDriverDocument: z.object({
    params: driverParams,
    body: driverDocumentBody,
  }),
  listDriverDocuments: z.object({ params: driverParams }),
  deleteDriverDocument: z.object({ params: driverDocumentParams }),

  recordDriverVerification: z.object({
    params: driverParams,
    body: driverVerificationBody,
  }),
  listDriverVerifications: z.object({ params: driverParams }),

  addDriverBankDetails: z.object({
    params: driverParams,
    body: driverBankDetailsBody,
  }),
  listDriverBankDetails: z.object({ params: driverParams }),
  setDriverBankDetailsVerification: z.object({
    params: driverBankDetailsParams,
    body: z.object({
      verificationStatus: z.enum(DRIVER_BANK_VERIFICATION_STATUSES),
    }),
  }),
  deleteDriverBankDetails: z.object({ params: driverBankDetailsParams }),

  getDriverOperationalStatus: z.object({ params: driverParams }),
  setDriverOperationalStatus: z.object({
    params: driverParams,
    body: z.object({
      operationalStatus: z.enum(DRIVER_OPERATIONAL_STATUSES),
      reason: z.string().min(1).max(500).optional(),
      effectiveAt: isoDateTime.optional(),
    }),
  }),

  recordDriverTripMetrics: z.object({
    params: driverParams,
    body: z.object({
      periodStart: isoDate,
      periodEnd: isoDate,
      tripsCount: z.number().int().nonnegative(),
      onTimePercentage: z.number().min(0).max(100),
    }),
  }),
  listDriverTripMetrics: z.object({ params: driverParams }),
};
