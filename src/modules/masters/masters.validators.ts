import { z } from "zod";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  IFSC_REGEX,
  MAX_PAGE_SIZE,
  REGISTRATION_NUMBER_REGEX,
} from "./masters.constants";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

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

export const mastersValidators = {
  createVehicle: z.object({
    body: z.object({
      registrationNumber: z
        .string()
        .regex(REGISTRATION_NUMBER_REGEX, "Invalid registration number"),
      vehicleType: z.string().min(1).max(50).optional(),
      make: z.string().min(1).max(50).optional(),
      model: z.string().min(1).max(50).optional(),
      capacityTons: z.number().positive().max(9999).optional(),
      ownershipType: z.enum(["owned", "leased"]).optional(),
    }),
  }),
  listVehicles: z.object({
    query: pagination.extend({
      status: z.enum(["active", "inactive", "under_maintenance"]).optional(),
    }),
  }),
  getVehicle: z.object({ params: vehicleParams }),
  updateVehicle: z.object({
    params: vehicleParams,
    body: z
      .object({
        vehicleType: z.string().min(1).max(50).optional(),
        make: z.string().min(1).max(50).optional(),
        model: z.string().min(1).max(50).optional(),
        capacityTons: z.number().positive().max(9999).optional(),
        ownershipType: z.enum(["owned", "leased"]).optional(),
        status: z.enum(["active", "inactive", "under_maintenance"]).optional(),
      })
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
  }),
  deleteVehicle: z.object({ params: vehicleParams }),

  addVehicleDocument: z.object({
    params: vehicleParams,
    body: z.object({
      documentType: z.enum(["rc", "insurance", "permit", "puc", "fitness"]),
      documentNumber: z.string().min(1).max(50).optional(),
      issueDate: isoDate.optional(),
      expiryDate: isoDate.optional(),
      fileUrl: z.string().min(1).optional(),
    }),
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
    body: z.object({
      fullName: z.string().min(1).max(150),
      phoneNumber: z.string().min(10).max(15),
      licenseNumber: z.string().min(1).max(30).optional(),
      licenseExpiry: isoDate.optional(),
      dateOfJoining: isoDate.optional(),
    }),
  }),
  listDrivers: z.object({
    query: pagination.extend({
      status: z.enum(["active", "inactive", "blacklisted"]).optional(),
    }),
  }),
  getDriver: z.object({ params: driverParams }),
  updateDriver: z.object({
    params: driverParams,
    body: z
      .object({
        fullName: z.string().min(1).max(150).optional(),
        licenseNumber: z.string().min(1).max(30).optional(),
        licenseExpiry: isoDate.optional(),
        dateOfJoining: isoDate.optional(),
        status: z.enum(["active", "inactive", "blacklisted"]).optional(),
      })
      .refine(
        (data) => Object.keys(data).length > 0,
        "At least one field is required",
      ),
  }),
  deleteDriver: z.object({ params: driverParams }),

  addDriverDocument: z.object({
    params: driverParams,
    body: z.object({
      documentType: z.enum(["driving_license_front", "driving_license_back"]),
      fileUrl: z.string().min(1),
      verificationSource: z.enum(["sarathi", "manual"]).optional(),
    }),
  }),
  listDriverDocuments: z.object({ params: driverParams }),
  deleteDriverDocument: z.object({ params: driverDocumentParams }),

  recordDriverVerification: z.object({
    params: driverParams,
    body: z.object({
      verificationType: z.enum(["sarathi_dl"]),
      verificationStatus: z.enum([
        "pending",
        "verified",
        "not_found",
        "manual_review",
      ]),
      sourceReference: z.string().min(1).max(100).optional(),
      holderName: z.string().min(1).max(150).optional(),
      licenseNumber: z.string().min(1).max(30).optional(),
      validUntil: isoDate.optional(),
      addressLine1: z.string().min(1).max(255).optional(),
      addressLine2: z.string().min(1).max(255).optional(),
      city: z.string().min(1).max(100).optional(),
      pinCode: z.string().min(1).max(10).optional(),
      rawResponse: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  listDriverVerifications: z.object({ params: driverParams }),

  addDriverBankDetails: z.object({
    params: driverParams,
    body: z.object({
      accountNumber: z.string().min(6).max(30),
      ifsc: z.string().regex(IFSC_REGEX, "Invalid IFSC code"),
      accountHolderName: z.string().min(1).max(150).optional(),
    }),
  }),
  listDriverBankDetails: z.object({ params: driverParams }),
  setDriverBankDetailsVerification: z.object({
    params: driverBankDetailsParams,
    body: z.object({
      verificationStatus: z.enum(["pending", "verified", "rejected"]),
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
};
