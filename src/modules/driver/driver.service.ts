import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import {
  DriverBankVerificationStatus,
  DriverTenantRelationInitiator,
  DriverTenantRelationStatus,
} from './drivers.types';
import { DriverRepository } from './driver.repository';
import { DriverTenantRelationRepository } from './driver-tenant-relation.repository';
import { Paginated, paginate } from '../../shared/utils/pagination';
import { DlVerificationClient, SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { StorageService } from '../storage/storage.service';
import { OrganizationService } from '../organization/organization.service';
import { DriverPushNotifier } from './driver-push-notifier';
import {
  AddBankDetailsInput,
  AddDriverDocumentInput,
  CreateDriverInput,
  InviteDriverInput,
  ListDriversInput,
  OnboardDriverInput,
  RecordDriverTripMetricsInput,
  RecordVerificationInput,
  SetDriverOperationalStatusInput,
  UpdateDriverInput,
} from './drivers.interface';

/**
 * The flattened, tenant-facing shape of a driver: the global profile (fullName, phoneNumber,
 * dateOfJoining, salaryType/Amount, documents, verifications, bankDetails — all person-level, one
 * job at a time) with this tenant's DriverTenantRelationEntity fields (status, initiatedBy,
 * approvedBy/At, rejectionReason — the link's own approval-workflow state) and satellites
 * (operationalStatus, tripMetrics, vehicleLinks) spread on top — so existing API consumers see the
 * same response shape they always did, even though the data now lives across two tables. `id`
 * stays the driver's global id (the same value that's always been in the :driverId URL param);
 * `driverTenantRelationId` is the new row backing the approval fields, exposed for callers that
 * need it (e.g. accept/reject an invite).
 */
export interface DriverWithRelation extends Omit<DriverEntity, 'tenantRelations'> {
  driverTenantRelationId: string;
  tenantId: string;
  status: DriverTenantRelationStatus;
  initiatedBy: DriverTenantRelationInitiator;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  operationalStatus?: DriverOperationalStatusEntity;
  tripMetrics?: DriverTripMetricsEntity[];
  vehicleLinks?: DriverTenantRelationEntity['vehicleLinks'];
}

// Picks only the relation-specific fields, named explicitly — never a blind `...relation` spread.
// DriverTenantRelationEntity carries its own `id`/`createdBy`/`updatedBy`/`deletedAt`/`createdAt`/
// `updatedAt` audit columns (every TypeORM entity does), which would silently clobber the driver's
// own `id` etc. if spread after `...driver`. `id` must stay the driver's global id — the same
// value that's always been in the :driverId URL param — never the relation's own row id.
function flattenRelation(relation: DriverTenantRelationEntity): DriverWithRelation {
  const { driver } = relation;
  return {
    ...driver,
    driverTenantRelationId: relation.id,
    tenantId: relation.tenantId,
    status: relation.status,
    initiatedBy: relation.initiatedBy,
    approvedBy: relation.approvedBy,
    approvedAt: relation.approvedAt,
    rejectionReason: relation.rejectionReason,
    operationalStatus: relation.operationalStatus,
    tripMetrics: relation.tripMetrics,
    vehicleLinks: relation.vehicleLinks,
  } as DriverWithRelation;
}

/**
 * Driver-portal profile screen — everything getDriver/findByIdWithRelations already returns
 * (fullName, phoneNumber, documents, verifications, bankDetails, vehicleLinks, etc., unchanged),
 * plus a handful of new fields aggregated from the assigned vehicle (masters.vehicles/
 * vehicle_documents/truck_types), trip metrics, and the organization's name. Fields with no
 * backing data anywhere in this build (experience, KMs driven, settlement due, and every Settings
 * entry — none of these are tracked server-side yet) are explicit `null`, not omitted, so the
 * driver app can render a consistent "—" placeholder rather than branching on a missing key.
 *
 * `documentStatus` (a derived summary) is deliberately named apart from the entity's own
 * `documents` array (the raw DriverDocumentEntity rows) so neither shadows the other.
 */
export interface DriverProfileView extends DriverWithRelation {
  organizationName: string | null;
  experienceYears: number | null;
  vehicle: {
    registrationNumber: string;
    type: string | null;
    insuranceValidTill: string | null;
    fitnessValidTill: string | null;
  } | null;
  documentStatus: {
    drivingLicence: { uploaded: boolean; verified: boolean } | null;
    identityProof: { uploaded: boolean; verified: boolean } | null;
  };
  performance: {
    tripsCompleted: number | null;
    onTimeDeliveryPercentage: number | null;
    kmsDriven: number | null;
    settlementDue: number | null;
  };
  settings: {
    notificationsEnabled: boolean | null;
    language: string | null;
    locationSharing: string | null;
    appVersion: string | null;
  };
}

export class DriverService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly dataSource: DataSource,
    private readonly dlVerificationClient: DlVerificationClient,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly organizationService: OrganizationService,
    private readonly driverPushNotifier: DriverPushNotifier,
  ) {}

  /**
   * Driving-licence front/back photos (manual Sarathi-review route) are uploaded to S3 through the
   * storage module first — see storage.constants.ts's `masters/driver` purpose. `document.fileUrl`
   * here is that upload's storage `key`, not an arbitrary external URL; this rejects anything that
   * isn't a confirmed, correctly-scoped `masters/driver` upload before it's attached to the driver.
   */
  private async assertDriverDlUpload(
    tenantId: string,
    actorRole: string,
    key: string,
  ): Promise<void> {
    try {
      const { file } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
      if (file.purpose !== 'masters/driver') {
        throw new ValidationError(`File ${key} was not uploaded for a driver document`);
      }
      if (file.status !== 'confirmed') {
        throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
      }
    } catch (error) {
      rethrow(error, 'Failed to verify uploaded driver document');
    }
  }

  /** Resolves a document's stored S3 key into a fresh, short-lived download URL for the response. */
  private async withDocumentDownloadUrl(
    tenantId: string,
    actorRole: string,
    document: DriverDocumentEntity,
  ): Promise<DriverDocumentEntity> {
    const { downloadUrl } = await this.storageService.getByKey(
      { tenantId, role: actorRole },
      document.fileUrl,
    );
    return downloadUrl ? { ...document, fileUrl: downloadUrl } : document;
  }

  /**
   * Preflight check used by the "Verify the driving licence" step of the Add-a-driver form,
   * before the driver record exists — so this never touches `driverRepository`. The caller (the
   * onboarding form) decides what to do with the result: bundle it into `onboardDriver.verification`
   * on `verified`, or switch to the manual-entry fields (photo uploads + typed-in details) and submit
   * that instead on `manual_review`.
   */
  async checkDrivingLicence(
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    try {
      return await this.dlVerificationClient.lookupDrivingLicence(licenseNumber, dateOfBirth);
    } catch (error) {
      rethrow(error, 'Failed to check driving licence against Sarathi');
    }
  }

  /**
   * Finds the global driver profile by phone, or creates a new one. The profile is person-level —
   * shared across every tenant this phone ever links to — so an existing profile is reused as-is
   * (its own fields are not overwritten by a second tenant's onboarding form).
   */
  private async findOrCreateDriverProfile(
    actorId: string,
    input: CreateDriverInput,
    manager: EntityManager,
  ): Promise<DriverEntity> {
    const existingByPhone = await this.driverRepository.findByPhoneNumber(input.phoneNumber);
    if (existingByPhone) return existingByPhone;

    if (input.licenseNumber) {
      const licenseOwner = await this.driverRepository.findByLicenseNumber(
        input.licenseNumber.toUpperCase(),
      );
      if (licenseOwner) {
        throw new ConflictError('A driver with this license number already exists');
      }
    }

    return await this.driverRepository.create(
      {
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        licenseNumber: input.licenseNumber?.toUpperCase() ?? null,
        licenseExpiry: input.licenseExpiry ?? null,
        dateOfJoining: input.dateOfJoining ?? null,
        salaryType: input.salaryType ?? null,
        salaryAmount: input.salaryAmount === undefined ? null : String(input.salaryAmount),
        dateOfBirth: input.dateOfBirth ?? null,
        bloodGroup: input.bloodGroup ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        pinCode: input.pinCode ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        // Emergency-contact relation and insurance are driver-self-registration-only concepts
        // (see driver-identity.service.ts) — staff onboarding doesn't collect them.
        emergencyContactRelation: null,
        hasLifeInsurance: false,
        hasHealthInsurance: false,
        registrationSource: 'staff_created',
        createdBy: actorId,
      },
      manager,
    );
  }

  /**
   * Only called internally, by onboardDriver — there is no standalone create-driver route.
   * org_admin's own driver lands `active` immediately; dispatch's (the only other role
   * masters.routes.ts's canWrite gate admits) lands `pending_staff_review` until an org_admin
   * reviews it via approveDriver/rejectDriver.
   */
  private async createDriver(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: CreateDriverInput,
    manager?: EntityManager,
  ): Promise<{ driver: DriverEntity; relation: DriverTenantRelationEntity }> {
    try {
      const run = async (txManager: EntityManager) => {
        const driver = await this.findOrCreateDriverProfile(actorId, input, txManager);

        const existingRelation = await this.driverTenantRelationRepository.findByTenantAndDriver(
          tenantId,
          driver.id,
          txManager,
        );
        if (existingRelation) {
          throw new ConflictError('A driver with this phone number already exists');
        }

        const autoApproved = actorRole === ORG_ADMIN_ROLE;
        const relation = await this.driverTenantRelationRepository.create(
          {
            tenantId,
            driverId: driver.id,
            status: autoApproved ? 'active' : 'pending_staff_review',
            initiatedBy: 'staff',
            initiatedByUserId: actorId,
            driverRespondedAt: null,
            fleetOwnerRespondedAt: new Date(),
            approvedBy: autoApproved ? actorId : null,
            approvedAt: autoApproved ? new Date() : null,
            createdBy: actorId,
          },
          txManager,
        );

        return { driver, relation };
      };

      return manager ? await run(manager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to create driver');
    }
  }

  async listDrivers(
    tenantId: string,
    input: ListDriversInput,
  ): Promise<Paginated<DriverWithRelation>> {
    try {
      const { items, total } = await this.driverTenantRelationRepository.list(tenantId, input);
      return paginate(items.map(flattenRelation), total, input);
    } catch (error) {
      rethrow(error, 'Failed to list drivers');
    }
  }

  async getDriver(tenantId: string, driverId: string): Promise<DriverWithRelation> {
    try {
      const relation =
        await this.driverTenantRelationRepository.findByTenantAndDriverWithFullRelations(
          tenantId,
          driverId,
        );
      if (!relation) throw new NotFoundError(`Driver ${driverId} not found`);
      return flattenRelation(relation);
    } catch (error) {
      rethrow(error, 'Failed to fetch driver');
    }
  }

  /**
   * Profile screen for a driver with no active tenant relation yet (e.g. just finished
   * self-registration, hasn't joined a fleet owner) — just the global profile
   * (documents/verifications/bankDetails/insurances), none of the tenant-aggregated fields
   * getMyProfile below adds (those need a relation: vehicle assignment, org name, trip metrics).
   * See DriverPortalController.getMe, which picks this or getMyProfile based on whether the
   * caller's token carries a tenantId.
   */
  async getMyGlobalProfile(driverId: string): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithPersonRelations(driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver profile');
    }
  }

  // See DriverProfileView's doc comment for which fields are real vs. explicit null.
  async getMyProfile(tenantId: string, driverId: string): Promise<DriverProfileView> {
    try {
      const relation =
        await this.driverTenantRelationRepository.findByTenantAndDriverWithProfileRelations(
          tenantId,
          driverId,
        );
      if (!relation) throw new NotFoundError(`Driver ${driverId} not found`);
      const driver = flattenRelation(relation);
      const organization = await this.organizationService.getOrganizationStatus(tenantId);

      const activeLink =
        relation.vehicleLinks?.find((link) => link.status === 'active' && link.isPrimary) ??
        relation.vehicleLinks?.find((link) => link.status === 'active') ??
        null;

      let vehicle: DriverProfileView['vehicle'] = null;
      if (activeLink) {
        const latestByExpiry = (documentType: 'insurance' | 'fitness'): string | null => {
          const matches = (activeLink.vehicle.documents ?? []).filter(
            (doc) => doc.documentType === documentType && !doc.deletedAt && doc.expiryDate,
          );
          if (matches.length === 0) return null;
          return matches.reduce((latest, doc) =>
            !latest.expiryDate || (doc.expiryDate && doc.expiryDate > latest.expiryDate)
              ? doc
              : latest,
          ).expiryDate;
        };
        vehicle = {
          registrationNumber: activeLink.vehicle.registrationNumber,
          type: activeLink.vehicle.truckType?.name ?? null,
          insuranceValidTill: latestByExpiry('insurance'),
          fitnessValidTill: latestByExpiry('fitness'),
        };
      }

      const findDocument = (types: string[]) =>
        driver.documents?.find((doc) => types.includes(doc.documentType) && !doc.deletedAt) ?? null;
      const drivingLicenceDoc = findDocument(['driving_license_front', 'driving_license_back']);
      const identityProofDoc = findDocument(['aadhaar', 'pan']);

      const metrics = (relation.tripMetrics ?? []).filter((metric) => !metric.deletedAt);
      const tripsCompleted = metrics.length
        ? metrics.reduce((sum, metric) => sum + metric.tripsCount, 0)
        : null;
      const onTimeDeliveryPercentage =
        tripsCompleted && tripsCompleted > 0
          ? Number(
              (
                metrics.reduce(
                  (sum, metric) => sum + metric.tripsCount * Number(metric.onTimePercentage),
                  0,
                ) / tripsCompleted
              ).toFixed(2),
            )
          : null;

      return {
        ...driver, // fullName, phoneNumber, documents, verifications, bankDetails, vehicleLinks, etc. — unchanged
        organizationName: organization.name,
        experienceYears: null, // not tracked — no field distinguishes this from dateOfJoining
        vehicle,
        documentStatus: {
          drivingLicence: drivingLicenceDoc
            ? { uploaded: true, verified: !!drivingLicenceDoc.verifiedAt }
            : null,
          identityProof: identityProofDoc
            ? { uploaded: true, verified: !!identityProofDoc.verifiedAt }
            : null,
        },
        performance: {
          tripsCompleted,
          onTimeDeliveryPercentage,
          kmsDriven: null, // not tracked anywhere in this build
          settlementDue: null, // no driver settlement/earnings module exists yet
        },
        settings: {
          notificationsEnabled: null, // no driver notification-preference field exists yet
          language: null, // no driver locale/language field exists yet
          locationSharing: null, // no location-sharing preference field exists yet
          appVersion: null, // client-reported, not a server-side concept
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch driver profile');
    }
  }

  async updateDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: UpdateDriverInput,
  ): Promise<DriverWithRelation> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      const licenseNumber = input.licenseNumber?.toUpperCase();
      const licenseChanged =
        licenseNumber !== undefined && licenseNumber !== relation.driver.licenseNumber;

      if (input.phoneNumber !== undefined && input.phoneNumber !== relation.driver.phoneNumber) {
        const phoneOwner = await this.driverRepository.findByPhoneNumber(input.phoneNumber);
        if (phoneOwner) {
          throw new ConflictError('A driver with this phone number already exists');
        }
      }

      if (licenseChanged && licenseNumber) {
        const licenseOwner = await this.driverRepository.findByLicenseNumber(licenseNumber);
        if (licenseOwner) {
          throw new ConflictError('A driver with this license number already exists');
        }
      }

      const {
        dateOfJoining,
        salaryType,
        salaryAmount,
        fullName,
        phoneNumber,
        licenseExpiry,
        dateOfBirth,
        bloodGroup,
        addressLine1,
        addressLine2,
        city,
        pinCode,
        emergencyContactName,
        emergencyContactPhone,
      } = input;

      await this.driverRepository.update(driverId, {
        fullName,
        phoneNumber,
        licenseNumber,
        licenseVerified: licenseChanged ? false : undefined,
        licenseExpiry,
        dateOfJoining,
        salaryType,
        salaryAmount: salaryAmount === undefined ? undefined : String(salaryAmount),
        dateOfBirth,
        bloodGroup,
        addressLine1,
        addressLine2,
        city,
        pinCode,
        emergencyContactName,
        emergencyContactPhone,
        updatedBy: actorId,
      });

      return await this.getDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to update driver');
    }
  }

  /** Ends this tenant's relation to the driver — the shared global profile is untouched, since the
   * driver may still be linked to other tenants. */
  async deleteDriver(tenantId: string, actorId: string, driverId: string): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.driverTenantRelationRepository.softDelete(tenantId, driverId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver');
    }
  }

  async addDocument(
    tenantId: string,
    actorId: string,
    actorRole: string,
    driverId: string,
    input: AddDriverDocumentInput,
  ): Promise<DriverDocumentEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.assertDriverDlUpload(tenantId, actorRole, input.fileUrl);

      const verificationSource = input.verificationSource ?? 'manual';
      const document = await this.driverRepository.createDocument({
        tenantId,
        driverId,
        documentType: input.documentType,
        fileUrl: input.fileUrl,
        documentNumber: input.documentNumber ?? null,
        verificationSource,
        verifiedAt: null,
        createdBy: actorId,
      });
      return await this.withDocumentDownloadUrl(tenantId, actorRole, document);
    } catch (error) {
      rethrow(error, 'Failed to add driver document');
    }
  }

  async listDocuments(
    tenantId: string,
    actorRole: string,
    driverId: string,
  ): Promise<DriverDocumentEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const documents = await this.driverRepository.listDocuments(driverId);
      return await Promise.all(
        documents.map((document) => this.withDocumentDownloadUrl(tenantId, actorRole, document)),
      );
    } catch (error) {
      rethrow(error, 'Failed to list driver documents');
    }
  }

  async deleteDocument(
    tenantId: string,
    actorId: string,
    driverId: string,
    documentId: string,
  ): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findDocumentById(driverId, documentId);
      if (!existing) throw new NotFoundError(`Driver document ${documentId} not found`);
      await this.driverRepository.softDeleteDocument(driverId, documentId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver document');
    }
  }

  async recordVerification(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RecordVerificationInput,
    outerManager?: EntityManager,
  ): Promise<DriverVerificationEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId, outerManager);
      const verified = input.verificationStatus === 'verified';
      const licenseNumber = input.licenseNumber?.toUpperCase() ?? null;

      const run = async (manager: EntityManager) => {
        const verification = await this.driverRepository.createVerification(
          {
            tenantId,
            driverId,
            verificationType: input.verificationType,
            verificationStatus: input.verificationStatus,
            sourceReference: input.sourceReference ?? null,
            holderName: input.holderName ?? null,
            licenseNumber,
            validUntil: input.validUntil ?? null,
            licenseClass: input.licenseClass ?? null,
            licenseStatus: input.licenseStatus ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            pinCode: input.pinCode ?? null,
            rawResponse: input.rawResponse ?? null,
            verifiedAt: verified ? new Date() : null,
            createdBy: actorId,
          },
          manager,
        );

        // A successful check is the source of truth for the driver's licence fields.
        if (verified) {
          await this.driverRepository.update(
            driverId,
            {
              licenseVerified: true,
              licenseNumber: licenseNumber ?? undefined,
              licenseExpiry: input.validUntil ?? undefined,
              updatedBy: actorId,
            },
            manager,
          );
        }

        return verification;
      };

      return outerManager ? await run(outerManager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to record driver verification');
    }
  }

  async listVerifications(tenantId: string, driverId: string): Promise<DriverVerificationEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listVerifications(driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver verifications');
    }
  }

  async addBankDetails(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: AddBankDetailsInput,
  ): Promise<DriverBankDetailsEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const ifsc = input.ifsc.toUpperCase();
      const existing = await this.driverRepository.findBankDetailsByAccount(
        driverId,
        input.accountNumber,
        ifsc,
      );
      if (existing) {
        throw new ConflictError('This bank account is already on file for the driver');
      }

      return await this.driverRepository.createBankDetails({
        tenantId,
        driverId,
        accountNumber: input.accountNumber,
        ifsc,
        accountHolderName: input.accountHolderName ?? null,
        upiId: input.upiId ?? null,
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add driver bank details');
    }
  }

  async listBankDetails(tenantId: string, driverId: string): Promise<DriverBankDetailsEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listBankDetails(driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver bank details');
    }
  }

  async setBankDetailsVerification(
    tenantId: string,
    actorId: string,
    driverId: string,
    bankDetailsId: string,
    verificationStatus: DriverBankVerificationStatus,
  ): Promise<DriverBankDetailsEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findBankDetailsById(driverId, bankDetailsId);
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);

      const bankDetails = await this.driverRepository.updateBankDetailsVerification(
        driverId,
        bankDetailsId,
        {
          verificationStatus,
          verifiedAt: verificationStatus === 'verified' ? new Date() : null,
          updatedBy: actorId,
        },
      );
      if (!bankDetails) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      return bankDetails;
    } catch (error) {
      rethrow(error, 'Failed to update driver bank details verification');
    }
  }

  async deleteBankDetails(
    tenantId: string,
    actorId: string,
    driverId: string,
    bankDetailsId: string,
  ): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      const existing = await this.driverRepository.findBankDetailsById(driverId, bankDetailsId);
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      await this.driverRepository.softDeleteBankDetails(driverId, bankDetailsId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver bank details');
    }
  }

  async getOperationalStatus(
    tenantId: string,
    driverId: string,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      const status = await this.driverRepository.findOperationalStatus(relation.id);
      if (!status) throw new NotFoundError(`Driver ${driverId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver operational status');
    }
  }

  /** One row per driver-tenant relation, so the first call inserts and later calls overwrite it. */
  async setOperationalStatus(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: SetDriverOperationalStatusInput,
    manager?: EntityManager,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId, manager);

      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const existing = await this.driverRepository.findOperationalStatus(relation.id);

      if (!existing) {
        return await this.driverRepository.createOperationalStatus(
          {
            tenantId,
            driverTenantRelationId: relation.id,
            operationalStatus: input.operationalStatus,
            reason: input.reason ?? null,
            effectiveAt,
            createdBy: actorId,
          },
          manager,
        );
      }

      const status = await this.driverRepository.updateOperationalStatus(relation.id, {
        operationalStatus: input.operationalStatus,
        reason: input.reason ?? null,
        effectiveAt,
        updatedBy: actorId,
      });
      if (!status) throw new NotFoundError(`Driver ${driverId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to set driver operational status');
    }
  }

  /** Metrics are unique per reporting period, so re-reporting a period overwrites it. */
  async recordTripMetrics(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RecordDriverTripMetricsInput,
  ): Promise<DriverTripMetricsEntity> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);

      if (input.periodEnd < input.periodStart) {
        throw new ValidationError('periodEnd must not be earlier than periodStart');
      }

      const onTimePercentage = String(input.onTimePercentage);
      const existing = await this.driverRepository.findTripMetricsByPeriod(
        relation.id,
        input.periodStart,
        input.periodEnd,
      );

      if (!existing) {
        return await this.driverRepository.createTripMetrics({
          tenantId,
          driverTenantRelationId: relation.id,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          tripsCount: input.tripsCount,
          onTimePercentage,
          createdBy: actorId,
        });
      }

      const metrics = await this.driverRepository.updateTripMetrics(existing.id, {
        tripsCount: input.tripsCount,
        onTimePercentage,
        updatedBy: actorId,
      });
      if (!metrics) throw new NotFoundError(`Trip metrics ${existing.id} not found`);
      return metrics;
    } catch (error) {
      rethrow(error, 'Failed to record driver trip metrics');
    }
  }

  async listTripMetrics(tenantId: string, driverId: string): Promise<DriverTripMetricsEntity[]> {
    try {
      const relation = await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listTripMetrics(relation.id);
    } catch (error) {
      rethrow(error, 'Failed to list driver trip metrics');
    }
  }

  /**
   * Backs the single "Save driver" button: creates the driver and every section of the form in one
   * transaction, so a failure partway through rolls the whole thing back rather than leaving a
   * half-built driver behind. Returns the driver with its relations loaded.
   */
  async onboardDriver(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: OnboardDriverInput,
  ): Promise<DriverWithRelation> {
    try {
      const { verification, bankDetails, documents, operationalStatus, ...driverInput } = input;

      const driverId = await this.dataSource.transaction(async (manager) => {
        const { driver } = await this.createDriver(
          tenantId,
          actorId,
          actorRole,
          driverInput,
          manager,
        );

        if (verification) {
          await this.recordVerification(tenantId, actorId, driver.id, verification, manager);
        }

        for (const document of documents ?? []) {
          await this.assertDriverDlUpload(tenantId, actorRole, document.fileUrl);
          await this.driverRepository.createDocument(
            {
              tenantId,
              driverId: driver.id,
              documentType: document.documentType,
              fileUrl: document.fileUrl,
              documentNumber: document.documentNumber ?? null,
              verificationSource: document.verificationSource ?? 'manual',
              verifiedAt: null,
              createdBy: actorId,
            },
            manager,
          );
        }

        if (bankDetails) {
          await this.driverRepository.createBankDetails(
            {
              tenantId,
              driverId: driver.id,
              accountNumber: bankDetails.accountNumber,
              ifsc: bankDetails.ifsc.toUpperCase(),
              accountHolderName: bankDetails.accountHolderName ?? null,
              upiId: bankDetails.upiId ?? null,
              createdBy: actorId,
            },
            manager,
          );
        }

        await this.setOperationalStatus(
          tenantId,
          actorId,
          driver.id,
          {
            operationalStatus: operationalStatus?.operationalStatus ?? 'active',
            reason: operationalStatus?.reason,
            effectiveAt: operationalStatus?.effectiveAt,
          },
          manager,
        );

        return driver.id;
      });

      return await this.getDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to onboard driver');
    }
  }

  /**
   * Fleet-owner-initiated invite: a staff member invites a driver by phone. If the phone has no
   * global profile yet, a minimal shell profile is created (an invite can predate registration) —
   * the driver fills in their own details when they self-register/accept.
   */
  async inviteDriverByPhone(
    tenantId: string,
    actorId: string,
    input: InviteDriverInput,
  ): Promise<DriverWithRelation> {
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        let driver = await this.driverRepository.findByPhoneNumber(input.phoneNumber);
        if (!driver) {
          driver = await this.driverRepository.create(
            {
              fullName: input.fullName ?? 'Pending driver',
              phoneNumber: input.phoneNumber,
              licenseNumber: null,
              licenseExpiry: null,
              dateOfJoining: input.dateOfJoining ?? null,
              salaryType: input.salaryType ?? null,
              salaryAmount: input.salaryAmount === undefined ? null : String(input.salaryAmount),
              dateOfBirth: null,
              bloodGroup: null,
              addressLine1: null,
              addressLine2: null,
              city: null,
              pinCode: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              emergencyContactRelation: null,
              hasLifeInsurance: false,
              hasHealthInsurance: false,
              registrationSource: 'staff_created',
              createdBy: actorId,
            },
            manager,
          );
        }

        const existingRelation = await this.driverTenantRelationRepository.findByTenantAndDriver(
          tenantId,
          driver.id,
          manager,
        );
        if (existingRelation) {
          throw new ConflictError('A driver with this phone number already exists');
        }

        const relation = await this.driverTenantRelationRepository.create(
          {
            tenantId,
            driverId: driver.id,
            status: 'pending_driver_review',
            initiatedBy: 'fleet_owner',
            initiatedByUserId: actorId,
            driverRespondedAt: null,
            fleetOwnerRespondedAt: new Date(),
            approvedBy: null,
            approvedAt: null,
            createdBy: actorId,
          },
          manager,
        );

        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'DRIVER_INVITED',
          resourceType: 'driver',
          oldData: null,
          newData: { driverId: driver.id, phoneNumber: input.phoneNumber },
        });

        return flattenRelation({ ...relation, driver });
      });

      const organization = await this.organizationService.getOrganizationStatus(tenantId);
      await this.driverPushNotifier.notifyInvited(result.id, organization.name ?? 'A fleet owner');

      return result;
    } catch (error) {
      rethrow(error, 'Failed to invite driver');
    }
  }

  /** Relations awaiting staff review, from either origin (dispatch onboarding or a driver join-request). */
  async listPendingStaffReview(tenantId: string): Promise<DriverWithRelation[]> {
    try {
      const relations = await this.driverTenantRelationRepository.listPendingStaffReview(tenantId);
      const withDrivers = await Promise.all(
        relations.map(async (relation) => ({
          ...relation,
          driver: (await this.driverRepository.findById(relation.driverId))!,
        })),
      );
      return withDrivers.map(flattenRelation);
    } catch (error) {
      rethrow(error, 'Failed to list pending driver join requests');
    }
  }

  /**
   * Shared by this service and the fleet-link service, which needs the relation to exist before
   * linking. A relation in `rejected` status is treated as not found — a rejected driver has no
   * standing with this tenant. Callers inside a transaction must pass the manager, or the read runs
   * on another connection and cannot see a relation created moments earlier in the same
   * uncommitted transaction.
   */
  async assertDriverExists(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity & { driver: DriverEntity }> {
    try {
      const relation = await this.driverTenantRelationRepository.findByTenantAndDriver(
        tenantId,
        driverId,
        manager,
      );
      if (!relation || relation.status === 'rejected') {
        throw new NotFoundError(`Driver ${driverId} not found`);
      }
      const driver = await this.driverRepository.findById(driverId, manager);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return { ...relation, driver };
    } catch (error) {
      rethrow(error, 'Failed to verify driver exists');
    }
  }

  /** Approves a `pending_staff_review` relation — dispatch's own onboarding, or a driver's join request. */
  async approveDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
  ): Promise<DriverWithRelation> {
    try {
      const existing = await this.assertDriverExists(tenantId, driverId);
      if (existing.status !== 'pending_staff_review') {
        throw new ConflictError('Only a pending driver can be approved');
      }

      const relation = await this.driverTenantRelationRepository.approve(
        tenantId,
        existing.id,
        actorId,
      );
      if (!relation) throw new ConflictError('Driver approval failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_APPROVED',
        resourceType: 'driver',
        oldData: { id: driverId, status: 'pending_staff_review' },
        newData: { id: driverId, status: 'active', approvedBy: actorId },
      });

      // Driver-initiated join requests are the only case where the driver is waiting on this
      // decision — a dispatch-added driver (initiatedBy: 'staff') has no session to notify yet.
      if (existing.initiatedBy === 'driver') {
        const organization = await this.organizationService.getOrganizationStatus(tenantId);
        await this.driverPushNotifier.notifyJoinRequestApproved(
          driverId,
          organization.name ?? 'the fleet owner',
        );
      }

      return await this.getDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to approve driver');
    }
  }

  async rejectDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
    reason: string,
  ): Promise<DriverWithRelation> {
    try {
      const existing = await this.assertDriverExists(tenantId, driverId);
      if (existing.status !== 'pending_staff_review') {
        throw new ConflictError('Only a pending driver can be rejected');
      }

      const relation = await this.driverTenantRelationRepository.reject(
        tenantId,
        existing.id,
        actorId,
        reason,
      );
      if (!relation) throw new ConflictError('Driver rejection failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_REJECTED',
        resourceType: 'driver',
        oldData: { id: driverId, status: 'pending_staff_review' },
        newData: { id: driverId, status: 'rejected', rejectionReason: reason },
      });

      if (existing.initiatedBy === 'driver') {
        const organization = await this.organizationService.getOrganizationStatus(tenantId);
        await this.driverPushNotifier.notifyJoinRequestRejected(
          driverId,
          organization.name ?? 'the fleet owner',
        );
      }

      return flattenRelation({ ...relation, driver: existing.driver });
    } catch (error) {
      rethrow(error, 'Failed to reject driver');
    }
  }
}
