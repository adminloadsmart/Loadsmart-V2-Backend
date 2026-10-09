import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/entities/user.entity';
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
import {
  DriverTenantRelationRepository,
  inviteSendColumns,
} from './driver-tenant-relation.repository';
import { Paginated, paginate } from '../../shared/utils/pagination';
import { DlVerificationClient, SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { StorageService } from '../storage/storage.service';
import { OrganizationService } from '../organization/organization.service';
import { DriverPushNotifier } from './auth/driver-push-notifier';
import {
  BankAccountVerificationResult,
  IdfyClient,
  toBankVerificationColumns,
} from '../../adapters/idfy.client';
import {
  AddBankDetailsInput,
  AddDriverDocumentInput,
  CreateDriverInput,
  ListDriversInput,
  ListJoinRequestsInput,
  ListInvitationsInput,
  DriverInvitationView,
  DriverInvitationDetailView,
  DriverInvitationTimelineStep,
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
  /** When this tenant link was created — the "Requested 2 days ago" timestamp. `createdAt` is the
   * global driver profile's, which predates the request for a driver already on the platform. */
  requestedAt: Date;
  /** Latest `driver_verifications.license_class` (e.g. "HTV Heavy Transport"); null when the
   * verifications weren't loaded or none carries a class. */
  licenseClass: string | null;
  operationalStatus?: DriverOperationalStatusEntity;
  tripMetrics?: DriverTripMetricsEntity[];
  vehicleLinks?: DriverTenantRelationEntity['vehicleLinks'];
}

// Picks only the relation-specific fields, named explicitly — never a blind `...relation` spread.
// DriverTenantRelationEntity carries its own `id`/`createdBy`/`updatedBy`/`deletedAt`/`createdAt`/
// `updatedAt` audit columns (every TypeORM entity does), which would silently clobber the driver's
// own `id` etc. if spread after `...driver`. `id` must stay the driver's global id — the same
// value that's always been in the :driverId URL param — never the relation's own row id.
function latestLicenseClass(verifications: DriverVerificationEntity[] | undefined): string | null {
  const latest = (verifications ?? [])
    .filter((verification) => verification.licenseClass)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.licenseClass ?? null;
}

// Only ever called on rows listInvitations/resendInvite returned — tenant-initiated, invite sent —
// so anything that isn't pending/active is a driver decline.
function toInvitationView(relation: DriverTenantRelationEntity): DriverInvitationView {
  let status: DriverInvitationView['status'];
  if (relation.status === 'active') status = 'accepted';
  else if (relation.status === 'rejected') status = 'rejected';
  else if (relation.inviteExpiresAt && relation.inviteExpiresAt <= new Date()) status = 'expired';
  else status = 'pending';

  return {
    invitationId: relation.id,
    requestId: formatInviteRequestId(relation.inviteNumber),
    driverId: relation.driverId,
    fullName: relation.driver.fullName,
    phoneNumber: relation.driver.phoneNumber,
    status,
    sentAt: relation.inviteSentAt!,
    expiresAt: relation.inviteExpiresAt,
    respondedAt: relation.driverRespondedAt,
    rejectionReason: relation.rejectionReason,
  };
}

/** Sequential invite number → the drawer's "Req ID", e.g. 42 → INV-00042. */
function formatInviteRequestId(inviteNumber: string): string {
  return `INV-${inviteNumber.padStart(5, '0')}`;
}

function toInvitationDetailView(
  relation: DriverTenantRelationEntity,
  sender: UserEntity | null,
): DriverInvitationDetailView {
  const view = toInvitationView(relation);
  const { driver } = relation;

  const sarathiCheck = (driver.verifications ?? [])
    .filter((verification) => verification.verificationType === 'sarathi_dl')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  // Latest send only: sent → viewed → one final step derived from the existing status column.
  const timeline: DriverInvitationTimelineStep[] = [
    {
      step: 'sent',
      at: view.sentAt,
      by: sender ? { name: sender.fullName, role: sender.role?.name ?? null } : null,
    },
  ];
  if (relation.inviteViewedAt) {
    timeline.push({
      step: 'viewed',
      at: relation.inviteViewedAt,
      device: relation.inviteViewedDevice,
    });
  }
  if (view.status === 'accepted') {
    timeline.push({ step: 'accepted', at: relation.driverRespondedAt });
  } else if (view.status === 'rejected') {
    timeline.push({
      step: 'rejected',
      at: relation.driverRespondedAt,
      reason: relation.rejectionReason,
    });
  } else if (view.status === 'expired') {
    timeline.push({ step: 'expired', at: relation.inviteExpiresAt });
  } else {
    timeline.push({ step: 'awaiting_response', at: null });
  }

  return {
    ...view,
    credentials: {
      licenseNumber: driver.licenseNumber,
      licenseClass: latestLicenseClass(driver.verifications),
      registry: sarathiCheck
        ? {
            source: 'sarathi',
            status: sarathiCheck.verificationStatus,
            checkedAt: sarathiCheck.verifiedAt ?? sarathiCheck.createdAt,
          }
        : null,
    },
    timeline,
    deliveryChannels: [
      {
        channel: 'sms',
        status: relation.smsDeliveryStatus,
        statusAt: relation.smsDeliveryStatusAt,
      },
      {
        channel: 'whatsapp',
        status: relation.whatsappDeliveryStatus,
        statusAt: relation.whatsappDeliveryStatusAt,
      },
      {
        channel: 'push',
        status: relation.pushDeliveryStatus,
        statusAt: relation.pushDeliveryStatusAt,
      },
    ],
  };
}

export function flattenRelation(relation: DriverTenantRelationEntity): DriverWithRelation {
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
    requestedAt: relation.createdAt,
    licenseClass: latestLicenseClass(driver.verifications),
    operationalStatus: relation.operationalStatus,
    tripMetrics: relation.tripMetrics,
    vehicleLinks: relation.vehicleLinks,
  } as DriverWithRelation;
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
    private readonly idfyClient: IdfyClient,
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
   * Bank-account preflight, the bank counterpart of checkDrivingLicence: checks an account +
   * IFSC against IDfy before the bank details exist. Submits an async IDfy task and polls for the
   * result before responding. Read-only — every save path (addBankDetails, onboardDriver,
   * DriverIdentityService.completeRegistration) re-runs this same check server-side and persists
   * that result, so nothing the client sends can mark an account verified.
   */
  async checkBankAccount(
    accountNumber: string,
    ifsc: string,
  ): Promise<BankAccountVerificationResult> {
    try {
      return await this.idfyClient.verifyBankAccount(accountNumber, ifsc.toUpperCase());
    } catch (error) {
      rethrow(error, 'Failed to check bank account');
    }
  }

  /** Runs the IDfy check and shapes it into driver_bank_details columns. */
  private async verifyBankAccountFields(accountNumber: string, ifsc: string) {
    return toBankVerificationColumns(await this.idfyClient.verifyBankAccount(accountNumber, ifsc));
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
        hasLifeInsurance: 'no',
        hasHealthInsurance: 'no',
        registrationSource: 'staff_created',
        createdBy: actorId,
      },
      manager,
    );
  }

  /**
   * Only called internally, by onboardDriver — there is no standalone create-driver route.
   * org_admin's driver goes straight to the driver as a join request (`pending_driver_review`);
   * dispatch's (the only other role the canWrite gate admits) lands `pending_staff_review` until an
   * org_admin approves it via approveDriver, which is what sends the request to the driver.
   * Neither path makes the driver `active` — only the driver's own accept does.
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

        const isAdmin = actorRole === ORG_ADMIN_ROLE;
        // org_admin's driver is invited right away; dispatch's only once approveDriver runs.
        const relation = await this.driverTenantRelationRepository.create(
          {
            tenantId,
            driverId: driver.id,
            status: isAdmin ? 'pending_driver_review' : 'pending_staff_review',
            initiatedBy: isAdmin ? 'fleet_owner' : 'staff',
            initiatedByUserId: actorId,
            driverRespondedAt: null,
            fleetOwnerRespondedAt: new Date(),
            approvedBy: null,
            approvedAt: null,
            ...(isAdmin && inviteSendColumns(actorId, new Date())),
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
      // The list loads driver.verifications only to derive licenseClass — drop the raw rows
      // (they carry IDfy's rawResponse) so the list payload stays as lean as before.
      const drivers = items.map((relation) => {
        const { verifications: _verifications, ...driver } = flattenRelation(relation);
        return driver as DriverWithRelation;
      });
      return paginate(drivers, total, input);
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
        ...(await this.verifyBankAccountFields(input.accountNumber, ifsc)),
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add driver bank details');
    }
  }

  /** Driver-app self-service add — keyed on the driver's global id alone (no tenant relation
   *  needed, same as registration-time bank details, tenantId null). Verified against IDfy
   *  in-request, like addBankDetails. */
  async addOwnBankDetails(
    driverId: string,
    input: AddBankDetailsInput,
  ): Promise<DriverBankDetailsEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithPersonRelations(driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
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
        tenantId: null,
        driverId,
        accountNumber: input.accountNumber,
        ifsc,
        accountHolderName: input.accountHolderName ?? null,
        upiId: input.upiId ?? null,
        ...(await this.verifyBankAccountFields(input.accountNumber, ifsc)),
        createdBy: null,
      });
    } catch (error) {
      rethrow(error, 'Failed to add bank details');
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

      // Outside the transaction — the IDfy poll can take ~15s and shouldn't hold it open.
      const bankVerification = bankDetails
        ? await this.verifyBankAccountFields(
            bankDetails.accountNumber,
            bankDetails.ifsc.toUpperCase(),
          )
        : null;

      let invitationId: string | null = null;
      const driverId = await this.dataSource.transaction(async (manager) => {
        const { driver, relation } = await this.createDriver(
          tenantId,
          actorId,
          actorRole,
          driverInput,
          manager,
        );
        if (relation.status === 'pending_driver_review') invitationId = relation.id;

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
              ...bankVerification,
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

      if (invitationId) await this.deliverInvite(tenantId, invitationId, driverId);

      return await this.getDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to onboard driver');
    }
  }

  /**
   * "Requests to You" — driver-initiated join requests awaiting this tenant's approval. Dispatch-
   * added drivers awaiting org_admin approval are also `pending_staff_review` but `initiatedBy:
   * 'staff'`; they surface via GET /drivers?status=pending_staff_review instead.
   */
  async listJoinRequests(
    tenantId: string,
    input: ListJoinRequestsInput,
  ): Promise<Paginated<DriverWithRelation>> {
    return this.listDrivers(tenantId, {
      ...input,
      status: 'pending_staff_review',
      initiatedBy: 'driver',
    });
  }

  /** "Invitations Sent" — every invite this tenant sent, with its derived display status. */
  async listInvitations(
    tenantId: string,
    input: ListInvitationsInput,
  ): Promise<Paginated<DriverInvitationView>> {
    try {
      const { items, total } = await this.driverTenantRelationRepository.listInvitations(
        tenantId,
        input,
      );
      return paginate(items.map(toInvitationView), total, input);
    } catch (error) {
      rethrow(error, 'Failed to list driver invitations');
    }
  }

  /** Invitation detail drawer — header, credentials, latest-send timeline, delivery channels. */
  async getInvitation(tenantId: string, invitationId: string): Promise<DriverInvitationDetailView> {
    try {
      const relation = await this.findInvitationOrThrow(tenantId, invitationId);
      const sender = relation.inviteSentBy
        ? await this.dataSource
            .getRepository(UserEntity)
            .findOne({ where: { id: relation.inviteSentBy }, relations: { role: true } })
        : null;
      return toInvitationDetailView(relation, sender);
    } catch (error) {
      rethrow(error, 'Failed to get driver invitation');
    }
  }

  /** Re-sends a pending, unexpired invite and restarts its DRIVER_INVITE_TTL_DAYS clock. */
  async resendInvite(
    tenantId: string,
    actorId: string,
    invitationId: string,
  ): Promise<DriverInvitationView> {
    try {
      const invite = await this.findInvitationOrThrow(tenantId, invitationId);
      if (invite.status !== 'pending_driver_review') {
        throw new ConflictError('Only a pending invitation can be resent');
      }
      if (invite.inviteExpiresAt && invite.inviteExpiresAt <= new Date()) {
        throw new ConflictError('This invitation has expired and can no longer be resent');
      }

      const relation = await this.driverTenantRelationRepository.resendInvite(
        tenantId,
        invite.id,
        actorId,
      );
      if (!relation) throw new ConflictError('Invitation resend failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_INVITE_RESENT',
        resourceType: 'driver',
        oldData: { id: invite.driverId, invitationId, inviteSentAt: invite.inviteSentAt },
        newData: { id: invite.driverId, invitationId, inviteSentAt: relation.inviteSentAt },
      });

      await this.deliverInvite(tenantId, relation.id, relation.driverId);

      return toInvitationView(relation);
    } catch (error) {
      rethrow(error, 'Failed to resend driver invitation');
    }
  }

  /**
   * Cancel — soft-deletes the pending invite, so it leaves the list and the driver's app, and
   * frees the tenant+driver unique slot for a fresh invite later.
   */
  async cancelInvite(tenantId: string, actorId: string, invitationId: string): Promise<void> {
    try {
      const invite = await this.findInvitationOrThrow(tenantId, invitationId);
      if (invite.status !== 'pending_driver_review') {
        throw new ConflictError('Only a pending invitation can be cancelled');
      }
      const cancelled = await this.driverTenantRelationRepository.cancelInvite(
        tenantId,
        invite.id,
        actorId,
      );
      if (!cancelled) throw new ConflictError('Invitation cancel failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_INVITE_CANCELLED',
        resourceType: 'driver',
        oldData: {
          id: invite.driverId,
          invitationId,
          status: invite.status,
          inviteSentAt: invite.inviteSentAt,
        },
        newData: null,
      });
    } catch (error) {
      rethrow(error, 'Failed to cancel driver invitation');
    }
  }

  private async findInvitationOrThrow(
    tenantId: string,
    invitationId: string,
  ): Promise<DriverTenantRelationEntity> {
    const invite = await this.driverTenantRelationRepository.findInvitation(tenantId, invitationId);
    if (!invite) throw new NotFoundError(`Invitation ${invitationId} not found`);
    return invite;
  }

  /**
   * The single place an invite goes out to the driver (first send from onboardDriver/approveDriver,
   * and Resend). Today only push is really sent and its result recorded; SMS/WhatsApp were stamped
   * `pending` by inviteSendColumns — wire the notification branch's sending in here once merged.
   */
  private async deliverInvite(
    tenantId: string,
    invitationId: string,
    driverId: string,
    tenantName?: string | null,
  ): Promise<void> {
    const name =
      tenantName ?? (await this.organizationService.getOrganizationStatus(tenantId)).name;
    const pushed = await this.driverPushNotifier.notifyInvited(
      tenantId,
      driverId,
      name ?? 'A fleet owner',
      invitationId,
    );
    await this.driverTenantRelationRepository.setPushDeliveryStatus(
      invitationId,
      pushed ? 'sent' : 'failed',
    );
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

  /**
   * Approves a `pending_staff_review` relation. A dispatch-added driver (initiatedBy: 'staff') is
   * only now sent the join request (`pending_driver_review`); a driver's own join request
   * (initiatedBy: 'driver') becomes `active`.
   */
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

      const sendToDriver = existing.initiatedBy !== 'driver';
      const nextStatus = sendToDriver ? 'pending_driver_review' : 'active';
      const relation = await this.driverTenantRelationRepository.approve(
        tenantId,
        existing.id,
        actorId,
        nextStatus,
      );
      if (!relation) throw new ConflictError('Driver approval failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'DRIVER_APPROVED',
        resourceType: 'driver',
        oldData: { id: driverId, status: 'pending_staff_review' },
        newData: { id: driverId, status: nextStatus, approvedBy: actorId },
      });

      const organization = await this.organizationService.getOrganizationStatus(tenantId);
      if (sendToDriver) {
        await this.deliverInvite(tenantId, existing.id, driverId, organization.name);
      } else {
        await this.driverPushNotifier.notifyJoinRequestApproved(
          tenantId,
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
    reason: string | null,
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
          tenantId,
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
