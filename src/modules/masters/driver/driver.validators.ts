import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { IFSC_REGEX } from '../masters.constants';
import {
  DRIVER_BANK_VERIFICATION_STATUSES,
  DRIVER_BLOOD_GROUPS,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_DOCUMENT_VERIFICATION_SOURCES,
  DRIVER_OPERATIONAL_STATUSES,
  DRIVER_SALARY_TYPES,
  DRIVER_STATUSES,
  DRIVER_VERIFICATION_STATUSES,
  DRIVER_VERIFICATION_TYPES,
} from './drivers.types';

const uuid = z.string().uuid();
/** Full timestamp, unlike `isoDate` — used where a moment rather than a day is meant. */
const isoDateTime = z.iso.datetime();

const driverParams = z.object({ driverId: uuid });
const driverDocumentParams = z.object({ driverId: uuid, documentId: uuid });
const driverBankDetailsParams = z.object({
  driverId: uuid,
  bankDetailsId: uuid,
});

/**
 * Licence numbers are typed as printed — "MH12 20190012345" — but formats vary too much across
 * states for a format regex, so normalise whitespace and case only. Without this the same licence
 * stores two ways and the tenant-unique index cannot catch the duplicate.
 */
const licenseNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => value.length >= 8 && value.length <= 30, 'Invalid driving licence number');

/** Shared by `createDriver` and the section-1 fields of `onboardDriver`. */
const driverCoreFields = {
  fullName: z.string().min(1).max(150),
  phoneNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number'),
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

const driverBankDetailsBody = z.object({
  accountNumber: z.string().min(6).max(30),
  ifsc: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code'),
  accountHolderName: z.string().min(1).max(150).optional(),
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
    query: pagination.extend({
      status: z.enum(DRIVER_STATUSES).optional(),
      operationalStatus: z.enum(['active', 'on_trip', 'on_leave', 'inactive']).optional(),
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
        status: z.enum(DRIVER_STATUSES).optional(),
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  deleteDriver: z.object({ params: driverParams }),
  approveDriver: z.object({ params: driverParams }),
  rejectDriver: z.object({
    params: driverParams,
    body: z.object({ reason: z.string().trim().min(1) }),
  }),

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
