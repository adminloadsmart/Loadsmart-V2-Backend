import { z } from "zod";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  IFSC_REGEX,
  MAX_PAGE_SIZE,
  REGISTRATION_NUMBER_REGEX,
} from "./masters.constants";
import {
  BODY_TYPES,
  FUEL_TYPES,
  OWNERSHIP_TYPES,
  VEHICLE_DOCUMENT_TYPES,
  VEHICLE_OPERATIONAL_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  VEHICLE_VERIFICATION_STATUSES,
  VEHICLE_VERIFICATION_TYPES,
  WHEEL_COUNTS,
} from "./utils/vehicle.type";
import {
  DRIVER_BANK_VERIFICATION_STATUSES,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_DOCUMENT_VERIFICATION_SOURCES,
  DRIVER_OPERATIONAL_STATUSES,
  DRIVER_STATUSES,
  DRIVER_VERIFICATION_STATUSES,
  DRIVER_VERIFICATION_TYPES,
} from "./utils/drivers.types";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");
/** Full timestamp, unlike `isoDate` — used where a moment rather than a day is meant. */
const isoDateTime = z.iso.datetime();

const pagination = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  search: z.string().min(1).optional(),
});

const vehicleParams = z.object({ vehicleId: uuid });
const vehicleDocumentParams = z.object({ vehicleId: uuid, documentId: uuid });
const driverParams = z.object({ driverId: uuid });
const driverDocumentParams = z.object({ driverId: uuid, documentId: uuid });
const driverBankDetailsParams = z.object({
  driverId: uuid,
  bankDetailsId: uuid,
});
const linkParams = z.object({ linkId: uuid });

/**
 * Number plates are typed as they appear on the vehicle — "KA01 AB 1234", sometimes lowercase — so
 * normalise before matching. Without this the regex rejects the very format the form asks for.
 */
const registrationNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .refine(
    (value) => REGISTRATION_NUMBER_REGEX.test(value),
    "Invalid registration number",
  );

/**
 * Licence numbers are typed as printed — "MH12 20190012345" — but formats vary too much across
 * states for a format regex, so normalise whitespace and case only. Without this the same licence
 * stores two ways and the tenant-unique index cannot catch the duplicate.
 */
const licenseNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .refine(
    (value) => value.length >= 8 && value.length <= 30,
    "Invalid driving licence number",
  );

const wheelCount = z
  .number()
  .int()
  .refine(
    (value) => (WHEEL_COUNTS as readonly number[]).includes(value),
    `Expected one of: ${WHEEL_COUNTS.join(", ")}`,
  );

/** Shared by `createVehicle` and the section-1 fields of `onboardVehicle`. */
const vehicleCoreFields = {
  registrationNumber,
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  make: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
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

const vehicleDocumentBody = z.object({
  documentType: z.enum(VEHICLE_DOCUMENT_TYPES),
  documentNumber: z.string().min(1).max(50).optional(),
  issueDate: isoDate.optional(),
  expiryDate: isoDate.optional(),
  fileUrl: z.string().min(1).optional(),
});

/** Shared by `createDriver` and the section-1 fields of `onboardDriver`. */
const driverCoreFields = {
  fullName: z.string().min(1).max(150),
  phoneNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .refine(
      (value) => /^\d{10,15}$/.test(value),
      "Expected a 10-15 digit mobile number",
    ),
  licenseNumber: licenseNumber.optional(),
  licenseExpiry: isoDate.optional(),
  dateOfJoining: isoDate.optional(),
};

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
  pinCode: z.string().regex(/^\d{6}$/, "Expected a 6-digit PIN code").optional(),
  rawResponse: z.record(z.string(), z.unknown()).optional(),
});

const driverBankDetailsBody = z.object({
  accountNumber: z.string().min(6).max(30),
  ifsc: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => IFSC_REGEX.test(value), "Invalid IFSC code"),
  accountHolderName: z.string().min(1).max(150).optional(),
});

const driverDocumentBody = z.object({
  documentType: z.enum(DRIVER_DOCUMENT_TYPES),
  fileUrl: z.string().min(1),
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
    .regex(/^\d{6}$/, "Expected a 6-digit PIN code")
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
  createVehicle: z.object({
    body: z.object(vehicleCoreFields),
  }),
  /** The whole "Add a vehicle" form in one request. */
  onboardVehicle: z.object({
    body: z.object({
      ...vehicleCoreFields,
      verification: vehicleVerificationBody.optional(),
      telemetry: vehicleTelemetryBody.optional(),
      serviceUsage: vehicleServiceUsageBody.optional(),
      documents: z.array(vehicleDocumentBody).max(20).optional(),
      operationalStatus: vehicleOperationalStatusBody.optional(),
    }),
  }),
  listVehicles: z.object({
    query: pagination.extend({
      status: z.enum(VEHICLE_STATUSES).optional(),
      operationalStatus: z
        .enum(["on_trip", "idle", "warn_on_assign", "inactive"])
        .optional(),
    }),
  }),
  getVehicle: z.object({ params: vehicleParams }),
  updateVehicle: z.object({
    params: vehicleParams,
    body: z
      .object({
        vehicleType: z.enum(VEHICLE_TYPES).optional(),
        make: z.string().min(1).max(50).optional(),
        model: z.string().min(1).max(50).optional(),
        fuelType: z.enum(FUEL_TYPES).optional(),
        bodyType: z.enum(BODY_TYPES).optional(),
        wheelCount: wheelCount.optional(),
        capacityTons: z.number().positive().max(9999).optional(),
        ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
        status: z.enum(VEHICLE_STATUSES).optional(),
      })
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
  }),
  deleteVehicle: z.object({ params: vehicleParams }),

  getVehicleServiceUsage: z.object({ params: vehicleParams }),
  setVehicleServiceUsage: z.object({
    params: vehicleParams,
    body: vehicleServiceUsageBody.refine(
      (data) => Object.keys(data).length > 0,
      "At least one field is required",
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
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
  }),
  deleteVehicleDocument: z.object({ params: vehicleDocumentParams }),

  createDriver: z.object({
    body: z.object(driverCoreFields),
  }),
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
      operationalStatus: z
        .enum(["active", "on_trip", "on_leave", "inactive"])
        .optional(),
    }),
  }),
  getDriver: z.object({ params: driverParams }),
  updateDriver: z.object({
    params: driverParams,
    body: z
      .object({
        fullName: z.string().min(1).max(150).optional(),
        licenseNumber: licenseNumber.optional(),
        licenseExpiry: isoDate.optional(),
        dateOfJoining: isoDate.optional(),
        status: z.enum(DRIVER_STATUSES).optional(),
      })
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
  }),
  deleteDriver: z.object({ params: driverParams }),

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
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
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
};
