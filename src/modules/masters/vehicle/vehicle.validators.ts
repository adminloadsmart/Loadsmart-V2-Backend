import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { REGISTRATION_NUMBER_REGEX } from './vehicle.constants';
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
} from './vehicle.type';

const uuid = z.string().uuid();
/** Full timestamp, unlike `isoDate` — used where a moment rather than a day is meant. */
const isoDateTime = z.iso.datetime();

const vehicleParams = z.object({ vehicleId: uuid });
const vehicleDocumentParams = z.object({ vehicleId: uuid, documentId: uuid });

/**
 * Number plates are typed as they appear on the vehicle — "KA01 AB 1234", sometimes lowercase — so
 * normalise before matching. Without this the regex rejects the very format the form asks for.
 */
const registrationNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => REGISTRATION_NUMBER_REGEX.test(value), 'Invalid registration number');

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

/** Mirrors fleet-driver-link.validators.ts's linkDriver body — onboardVehicle links a driver via
 *  the same shape, in the same transaction as the rest of the vehicle form. */
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

export const vehicleValidators = {
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

  listComplianceAlerts: z.object({
    query: pagination.extend({
      documentType: z.enum(VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY).optional(),
    }),
  }),
};
