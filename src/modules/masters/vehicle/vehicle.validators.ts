import { z } from 'zod';
import { isoDateSchema as isoDate } from '../../../shared/utils/date';
import { paginationQuery as pagination } from '../../../shared/validators/pagination';
import { REGISTRATION_NUMBER_REGEX } from './vehicle.constants';
import { findPickerRow, PICKER_BODIES, PICKER_WHEEL_COUNTS } from './truck-type-picker.constants';
import {
  AXLE_TYPES,
  BODY_TYPES,
  COST_PAYERS,
  FUEL_TYPES,
  ONBOARD_OWNERSHIP_TYPES,
  OWNERSHIP_TYPES,
  TOLL_PAYERS,
  TYRE_CONDITION_PRESET_KEYS,
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

const money = z.number().nonnegative().max(9999999999);

/** The section-1 fields of `onboardVehicle` — what Vahan fills plus how the truck is held. Body,
 *  wheels and capacity come from `truckType` instead when it's sent (see onboardVehicle). */
const vehicleCoreFields = {
  registrationNumber,
  truckTypeId: uuid.optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  bodyType: z.enum(BODY_TYPES).optional(),
  makeModel: z.string().trim().min(1).max(100).optional(),
  wheelCount: wheelCount.optional(),
  capacityTons: z.number().positive().max(9999).optional(),
  ownershipType: z.enum(ONBOARD_OWNERSHIP_TYPES).optional(),
  grossVehicleWeightKg: z.number().int().positive().max(999999).optional(),
  unladenWeightKg: z.number().int().positive().max(999999).optional(),
  emissionNorm: z.string().trim().min(1).max(20).optional(),
  vahanBodyType: z.string().trim().min(1).max(50).optional(),
  financierName: z.string().trim().min(1).max(150).optional(),
};

/** The Add Truck drawer's truck-type picker. Exactly one of wheelCount / axleType, and the whole
 *  combination has to be one the picker offers. */
const truckTypePickBody = z
  .object({
    body: z.enum(PICKER_BODIES),
    wheelCount: z
      .number()
      .int()
      .refine(
        (value) => (PICKER_WHEEL_COUNTS as readonly number[]).includes(value),
        `Expected one of: ${PICKER_WHEEL_COUNTS.join(', ')}`,
      )
      .optional(),
    axleType: z.enum(AXLE_TYPES).optional(),
    capacityTons: z.number().positive().max(9999),
    bodyLengthFt: z.string().trim().min(1).max(10),
  })
  .strict()
  .refine(
    (pick) => (pick.wheelCount === undefined) !== (pick.axleType === undefined),
    'Send exactly one of wheelCount or axleType',
  )
  .refine(
    (pick) =>
      findPickerRow({
        body: pick.body,
        wheel: pick.wheelCount ?? pick.axleType!,
        capacityTons: pick.capacityTons,
        bodyLengthFt: pick.bodyLengthFt,
      }) !== null,
    'Not a truck type the picker offers',
  );

/** "Truck cost" for owned/financed trucks, "Lease and trip cost" for attached ones. */
const onboardCostBody = z
  .object({
    emiAmount: money.optional(),
    emiMonthsLeft: z.number().int().positive().max(360).optional(),
    insurancePremiumYearly: money.optional(),
    leaseRentMonthly: money.optional(),
    leaseEndDate: isoDate.optional(),
    fuelPaidBy: z.enum(COST_PAYERS).optional(),
    tollPaidBy: z.enum(TOLL_PAYERS).optional(),
  })
  .strict();

const LEASE_COST_FIELDS = ['leaseRentMonthly', 'leaseEndDate', 'fuelPaidBy', 'tollPaidBy'] as const;
const LOAN_COST_FIELDS = ['emiAmount', 'emiMonthsLeft', 'insurancePremiumYearly'] as const;

const gpsDeviceImei = z.string().regex(/^\d{15}$/, 'Expected the 15-digit IMEI on the device');

const onboardGpsBody = z
  .object({
    hasGps: z.boolean(),
    provider: z.string().trim().min(1).max(100).optional(),
    deviceImei: gpsDeviceImei.optional(),
  })
  .strict()
  .refine(
    (gps) => gps.hasGps || (gps.provider === undefined && gps.deviceImei === undefined),
    'provider and deviceImei need hasGps: true',
  );

const tyreSetBody = z
  .object({
    preset: z.enum(TYRE_CONDITION_PRESET_KEYS),
    positions: z
      .array(
        z
          .object({
            position: z
              .string()
              .trim()
              .min(1)
              .max(20)
              .regex(/^[A-Za-z0-9-]+$/, 'position must be letters, digits or -'),
            treadMm: z.number().positive().max(40),
            fittedAt: isoDate.optional(),
            brand: z.string().trim().min(1).max(100).optional(),
          })
          .strict(),
      )
      .max(22)
      .optional(),
  })
  .strict()
  .refine((set) => {
    const positions = (set.positions ?? []).map((p) => p.position.toUpperCase());
    return new Set(positions).size === positions.length;
  }, 'Each position can be set only once');

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
  fixedCostMonthly: z.number().nonnegative().max(9999999999).optional(),
});

const vehicleServiceUsageBody = z.object({
  odometerKm: z.number().int().nonnegative().max(9999999).optional(),
  lastServiceDate: isoDate.optional(),
  lastServiceOdometerKm: z.number().int().nonnegative().max(9999999).optional(),
  lastTyreChangeBrand: z.string().min(1).max(100).optional(),
  lastTyreChangeDate: isoDate.optional(),
  serviceIntervalKm: z.number().int().positive().max(999999).optional(),
  serviceIntervalMonths: z.number().int().positive().max(120).optional(),
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
    providerName: z.string().min(1).max(150).optional(),
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
  registeringAuthority: z.string().min(1).max(100).optional(),
  financierName: z.string().min(1).max(150).optional(),
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
      roadTaxValidTo: isoDate.optional(),
      insuranceProvider: z.string().min(1).max(150).optional(),
    })
    .optional(),
  responsePayload: z.record(z.string(), z.unknown()).optional(),
});

export const vehicleValidators = {
  /**
   * The whole "Add a truck" drawer in one request. Only registrationNumber and a truck type
   * (`truckType` from the picker, or an existing `truckTypeId`) are required; the rest are the
   * optional "Get more out of this truck" blocks.
   */
  onboardVehicle: z.object({
    body: z
      .object({
        ...vehicleCoreFields,
        truckType: truckTypePickBody.optional(),
        verification: vehicleVerificationBody.optional(),
        cost: onboardCostBody.optional(),
        gps: onboardGpsBody.optional(),
        tyres: tyreSetBody.optional(),
        /** @deprecated — the old form's EMI/GPS block; use `cost` and `gps`. */
        telemetry: vehicleTelemetryBody.optional(),
        serviceUsage: vehicleServiceUsageBody.optional(),
        documents: z.array(vehicleDocumentBody).max(20).optional(),
        operationalStatus: vehicleOperationalStatusBody.optional(),
        driverLink: driverLinkBody.nullish(),
      })
      .superRefine((body, ctx) => {
        if (!body.truckType && !body.truckTypeId) {
          ctx.addIssue({
            code: 'custom',
            path: ['truckType'],
            message: 'Pick a truck type',
          });
        }
        if (body.truckType && body.truckTypeId) {
          ctx.addIssue({
            code: 'custom',
            path: ['truckTypeId'],
            message: 'Send truckType or truckTypeId, not both',
          });
        }

        const attached = body.ownershipType === 'attached';
        // The owner services an attached truck and keeps its tyres under the lease.
        if (attached && body.serviceUsage) {
          ctx.addIssue({
            code: 'custom',
            path: ['serviceUsage'],
            message: 'An attached truck has no service reminders — its owner services it',
          });
        }
        if (attached && body.tyres) {
          ctx.addIssue({
            code: 'custom',
            path: ['tyres'],
            message: 'An attached truck has no tyre tracking — its owner handles tyres',
          });
        }

        const wrongCostFields = attached ? LOAN_COST_FIELDS : LEASE_COST_FIELDS;
        for (const field of wrongCostFields) {
          if (body.cost?.[field] !== undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['cost', field],
              message: attached
                ? `${field} is for owned or financed trucks`
                : `${field} is for attached trucks`,
            });
          }
        }
      }),
  }),
  listVehicles: z.object({
    query: pagination.extend({
      status: z.enum(VEHICLE_STATUSES).optional(),
      operationalStatus: z.enum(['on_trip', 'idle', 'warn_on_assign', 'inactive']).optional(),
    }),
  }),
  /** Same filters as listVehicles, minus paging — the export returns every match. */
  exportVehicles: z.object({
    query: z.object({
      status: z.enum(VEHICLE_STATUSES).optional(),
      operationalStatus: z.enum(['on_trip', 'idle', 'warn_on_assign', 'inactive']).optional(),
      search: z.string().min(1).optional(),
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
        makeModel: z.string().trim().min(1).max(100).optional(),
        wheelCount: wheelCount.optional(),
        capacityTons: z.number().positive().max(9999).optional(),
        ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
        axleType: z.enum(AXLE_TYPES).optional(),
        bodyLengthFt: z.string().trim().min(1).max(10).optional(),
        // under_maintenance is owned by the maintenance module — set when a breakdown is opened,
        // cleared when it is closed — so it can't be set here (see VehicleService.updateVehicle).
        status: z.enum(VEHICLE_STATUSES).exclude(['under_maintenance']).optional(),
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
        providerName: z.string().min(1).max(150).optional(),
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
        hasGps: z.boolean().optional(),
        gpsDeviceImei: gpsDeviceImei.optional(),
        emiAmount: money.optional(),
        emiEndDate: isoDate.optional(),
        insurancePremiumYearly: money.optional(),
        leaseRentMonthly: money.optional(),
        leaseEndDate: isoDate.optional(),
        fuelPaidBy: z.enum(COST_PAYERS).optional(),
        tollPaidBy: z.enum(TOLL_PAYERS).optional(),
        fixedCostMonthly: money.optional(),
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
