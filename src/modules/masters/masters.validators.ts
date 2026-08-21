import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../shared/utils/date';
import { paginationQuery as pagination } from '../../shared/validators/pagination';
import { IFSC_REGEX, REGISTRATION_NUMBER_REGEX } from './masters.constants';
import { TRUCK_BODY_TYPES } from './utils/truck-type.types';
import {
  BODY_TYPES,
  FUEL_TYPES,
  OWNERSHIP_TYPES,
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VEHICLE_OPERATIONAL_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_VERIFICATION_STATUSES,
  VEHICLE_VERIFICATION_TYPES,
  WHEEL_COUNTS,
} from './utils/vehicle.type';
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
} from './utils/drivers.types';
import { TRANSPORTER_COMPANY_TYPES, TRANSPORTER_STATUSES } from './utils/transporter.types';

const uuid = z.string().uuid();
/** Full timestamp, unlike `isoDate` — used where a moment rather than a day is meant. */
const isoDateTime = z.iso.datetime();

const vehicleParams = z.object({ vehicleId: uuid });
const vehicleDocumentParams = z.object({ vehicleId: uuid, documentId: uuid });
const driverParams = z.object({ driverId: uuid });
const driverDocumentParams = z.object({ driverId: uuid, documentId: uuid });
const driverBankDetailsParams = z.object({
  driverId: uuid,
  bankDetailsId: uuid,
});
const linkParams = z.object({ linkId: uuid });
const truckTypeParams = z.object({ truckTypeId: uuid });
const transporterParams = z.object({ transporterId: uuid });
const transporterPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{10,15}$/.test(value), 'Expected a 10-15 digit mobile number');
const transporterBankIfsc = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => IFSC_REGEX.test(value), 'Invalid IFSC code');
/** PRD §5.4.2 (FMS-MAS-TRN-001) — only name and phone are mandatory, everything else optional. */
const transporterFields = {
  name: z.string().trim().min(1).max(150),
  phone: transporterPhone,
  rate: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255).optional(),
  gstin: z.string().trim().min(1).max(15).optional(),
  msmeRegistration: z.string().trim().min(1).max(50).optional(),
  companyType: z.enum(TRANSPORTER_COMPANY_TYPES).optional(),
  status: z.enum(TRANSPORTER_STATUSES).optional(),
  advancePercentage: z.number().min(0).max(100).optional(),
  creditDays: z.number().int().nonnegative().max(36500).optional(),
  addressLine1: z.string().trim().min(1).max(255).optional(),
  addressLine2: z.string().trim().min(1).max(255).optional(),
  landmark: z.string().trim().min(1).max(255).optional(),
  areaLocality: z.string().trim().min(1).max(255).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  pinCode: z
    .string()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
    .optional(),
  bankAccountNumber: z.string().trim().min(6).max(30).optional(),
  bankIfsc: transporterBankIfsc.optional(),
  bankAccountHolderName: z.string().trim().min(1).max(150).optional(),
};

/**
 * Number plates are typed as they appear on the vehicle — "KA01 AB 1234", sometimes lowercase — so
 * normalise before matching. Without this the regex rejects the very format the form asks for.
 */
const registrationNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => REGISTRATION_NUMBER_REGEX.test(value), 'Invalid registration number');

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

const wheelCount = z
  .number()
  .int()
  .refine(
    (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
    `Expected one of: ${WHEEL_COUNTS.join(', ')}`,
  );

/** Shared by `createVehicle` and the section-1 fields of `onboardVehicle`. */
const vehicleCoreFields = {
  registrationNumber,
  truckTypeId: uuid.optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  bodyType: z.enum(BODY_TYPES).optional(),
  wheelCount: wheelCount.optional(),
  capacityTons: z.number().positive().max(9999).optional(),
  ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
};

const vehicleOperationalStatusBody = z.object({
  operationalStatus: z.enum(VEHICLE_OPERATIONAL_STATUSES),
  reason: z.string().min(1).max(500).optional(),
  effectiveAt: isoDateTime.optional(),
});

const vehicleTelemetryBody = z.object({
  gpsProvider: z.string().min(1).max(100).optional(),
  gpsEnabled: z.boolean().optional(),
  emiAmount: z.number().nonnegative().max(9999999999).optional(),
  emiEndDate: isoDate.optional(),
});

const vehicleServiceUsageBody = z.object({
  odometerKm: z.number().int().nonnegative().max(9999999).optional(),
  lastServiceDate: isoDate.optional(),
  lastServiceOdometerKm: z.number().int().nonnegative().max(9999999).optional(),
  lastTyreChangeBrand: z.string().min(1).max(100).optional(),
  lastTyreChangeDate: isoDate.optional(),
});

const driverLinkBody = z.object({
  driverId: uuid,
  isPrimary: z.boolean().optional(),
  linkedFrom: isoDate.optional(),
});

// The 5 dated papers (rc/insurance/permit/puc/fitness) dropped upload support per client request —
// fileUrl isn't an accepted field for them at all now, only documentNumber/issueDate/expiryDate.
// rc_front/rc_back are undated photos and keep fileUrl as their one field. Two `.strict()` object
// schemas in a union (rather than one shared object) so fileUrl is actually absent from the dated
// schema, not merely rejected by a refine.
const vehicleDocumentDatedBody = z
  .object({
    documentType: z.enum(VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY),
    documentNumber: z.string().min(1).max(50).optional(),
    issueDate: isoDate.optional(),
    expiryDate: isoDate.optional(),
  })
  .strict();

const vehicleDocumentPhotoBody = z
  .object({
    documentType: z.enum(['rc_front', 'rc_back']),
    fileUrl: z.string().min(1).optional(),
  })
  .strict();

const vehicleDocumentBody = z.union([vehicleDocumentDatedBody, vehicleDocumentPhotoBody]);

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

const vehicleVerificationBody = z.object({
  verificationType: z.enum(VEHICLE_VERIFICATION_TYPES),
  verificationStatus: z.enum(VEHICLE_VERIFICATION_STATUSES),
  sourceReference: z.string().min(1).max(100).optional(),
  registeredName: z.string().min(1).max(150).optional(),
  registeredOn: isoDate.optional(),
  vehicleClass: z.string().min(1).max(100).optional(),
  addressLine1: z.string().min(1).max(255).optional(),
  addressLine2: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(100).optional(),
  pinCode: z
    .string()
    .regex(/^\d{6}$/, 'Expected a 6-digit PIN code')
    .optional(),
  papers: z
    .object({
      insuranceValidTo: isoDate.optional(),
      rcValidTo: isoDate.optional(),
      permitValidTo: isoDate.optional(),
      pucValidTo: isoDate.optional(),
      fitnessValidTo: isoDate.optional(),
    })
    .optional(),
  responsePayload: z.record(z.string(), z.unknown()).optional(),
});

export const mastersValidators = {
  listTruckTypes: z.object({}),
  createTruckType: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(100),
      // 3-step picker (Plan Dispatch v2.0 §6.6) — all mandatory for a directly-created truck
      // type; rows added via "Add from catalog" (addTruckTypesFromCatalog below) skip these and
      // are edited in later, since the catalog only ever supplies a name.
      bodyType: z.enum(TRUCK_BODY_TYPES),
      wheelConfiguration: z
        .number()
        .refine(
          (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
          'Invalid wheel configuration',
        ),
      capacityTons: z.number().positive(),
      deckVolumeCubicMeters: z.number().positive(),
    }),
  }),
  deleteTruckType: z.object({ params: truckTypeParams }),
  // Market Fleet's 3-step picker — body type, then wheel configuration, then capacity — resolved
  // directly to a usable truckTypeId (get-or-create against this tenant's list).
  resolveTruckType: z.object({
    body: z.object({
      bodyType: z.enum(TRUCK_BODY_TYPES),
      wheelConfiguration: z
        .number()
        .refine(
          (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
          'Invalid wheel configuration',
        ),
      capacityTons: z.number().positive(),
    }),
  }),
  listTruckTypeCatalog: z.object({}),
  addTruckTypesFromCatalog: z.object({
    body: z.object({
      names: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    }),
  }),
  createTransporter: z.object({ body: z.object(transporterFields).strict() }),
  listTransporters: z.object({ query: pagination }),
  getTransporter: z.object({ params: transporterParams }),
  updateTransporter: z.object({
    params: transporterParams,
    body: z
      .object({
        ...transporterFields,
        rate: transporterFields.rate.nullable(),
        email: transporterFields.email.nullable(),
        gstin: transporterFields.gstin.nullable(),
        msmeRegistration: transporterFields.msmeRegistration.nullable(),
        companyType: transporterFields.companyType.nullable(),
        advancePercentage: transporterFields.advancePercentage.nullable(),
        creditDays: transporterFields.creditDays.nullable(),
        addressLine1: transporterFields.addressLine1.nullable(),
        addressLine2: transporterFields.addressLine2.nullable(),
        landmark: transporterFields.landmark.nullable(),
        areaLocality: transporterFields.areaLocality.nullable(),
        city: transporterFields.city.nullable(),
        state: transporterFields.state.nullable(),
        pinCode: transporterFields.pinCode.nullable(),
        bankAccountNumber: transporterFields.bankAccountNumber.nullable(),
        bankIfsc: transporterFields.bankIfsc.nullable(),
        bankAccountHolderName: transporterFields.bankAccountHolderName.nullable(),
      })
      .partial()
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
  }),
  deleteTransporter: z.object({ params: transporterParams }),

  /** The whole "Add a vehicle" form in one request. */
  onboardVehicle: z.object({
    body: z.object({
      ...vehicleCoreFields,
      verification: vehicleVerificationBody.optional(),
      telemetry: vehicleTelemetryBody.optional(),
      serviceUsage: vehicleServiceUsageBody.optional(),
      documents: z.array(vehicleDocumentBody).max(20).optional(),
      operationalStatus: vehicleOperationalStatusBody.optional(),
      driverLink: driverLinkBody.nullish(),
    }),
  }),
  listVehicles: z.object({
    query: pagination.extend({
      status: z.enum(VEHICLE_STATUSES).optional(),
      operationalStatus: z.enum(['on_trip', 'idle', 'warn_on_assign', 'inactive']).optional(),
    }),
  }),
  getVehicle: z.object({ params: vehicleParams }),
  updateVehicle: z.object({
    params: vehicleParams,
    body: z
      .object({
        truckTypeId: uuid.optional(),
        fuelType: z.enum(FUEL_TYPES).optional(),
        bodyType: z.enum(BODY_TYPES).optional(),
        wheelCount: wheelCount.optional(),
        capacityTons: z.number().positive().max(9999).optional(),
        ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
        status: z.enum(VEHICLE_STATUSES).optional(),
        // Selecting a driver from the edit-vehicle dropdown re-links it as the vehicle's primary
        // driver, in the same transaction as any other field changes here — see setPrimaryDriver.
        driverId: uuid.optional(),
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  deleteVehicle: z.object({ params: vehicleParams }),
  approveVehicle: z.object({ params: vehicleParams }),
  rejectVehicle: z.object({
    params: vehicleParams,
    body: z.object({ reason: z.string().trim().min(1) }),
  }),

  getVehicleServiceUsage: z.object({ params: vehicleParams }),
  setVehicleServiceUsage: z.object({
    params: vehicleParams,
    body: vehicleServiceUsageBody.refine(
      (data) => Object.keys(data).length > 0,
      'At least one field is required',
    ),
  }),

  addVehicleDocument: z.object({
    params: vehicleParams,
    body: vehicleDocumentBody,
  }),
  listVehicleDocuments: z.object({ params: vehicleParams }),
  updateVehicleDocument: z.object({
    params: vehicleDocumentParams,
    body: z
      .object({
        documentNumber: z.string().min(1).max(50).optional(),
        issueDate: isoDate.optional(),
        expiryDate: isoDate.optional(),
        fileUrl: z.string().min(1).optional(),
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),
  deleteVehicleDocument: z.object({ params: vehicleDocumentParams }),

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

  linkDriver: z.object({
    params: vehicleParams,
    body: z.object({
      driverId: uuid,
      isPrimary: z.boolean().optional(),
      linkedFrom: isoDate.optional(),
    }),
  }),
  listVehicleLinks: z.object({ params: vehicleParams }),
  listDriverLinks: z.object({ params: driverParams }),
  setLinkPrimary: z.object({ params: linkParams }),
  endLink: z.object({
    params: linkParams,
    body: z.object({ linkedTo: isoDate.optional() }),
  }),
  deleteLink: z.object({ params: linkParams }),

  getVehicleOperationalStatus: z.object({ params: vehicleParams }),
  setVehicleOperationalStatus: z.object({
    params: vehicleParams,
    body: z.object({
      operationalStatus: z.enum(VEHICLE_OPERATIONAL_STATUSES),
      reason: z.string().min(1).max(500).optional(),
      effectiveAt: isoDateTime.optional(),
    }),
  }),

  getVehicleTelemetryMeta: z.object({ params: vehicleParams }),
  setVehicleTelemetryMeta: z.object({
    params: vehicleParams,
    body: z
      .object({
        gpsProvider: z.string().min(1).max(100).optional(),
        gpsEnabled: z.boolean().optional(),
        emiAmount: z.number().nonnegative().max(9999999999).optional(),
        emiEndDate: isoDate.optional(),
      })
      .refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  }),

  recordVehicleVerification: z.object({
    params: vehicleParams,
    body: vehicleVerificationBody,
  }),
  listVehicleVerifications: z.object({ params: vehicleParams }),

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

  listComplianceAlerts: z.object({
    query: pagination.extend({
      documentType: z.enum(VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY).optional(),
    }),
  }),
};
