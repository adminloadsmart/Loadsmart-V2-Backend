import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  rethrow,
  ValidationError,
} from '../../shared/errors';
import { signToken } from '../../shared/utils/token';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { OtpService } from '../../shared/services/otp.service';
import { StorageService } from '../storage/storage.service';
import { OrganizationService } from '../organization/organization.service';
import { AuditService } from '../audit/audit.service';
import { NotifyByType } from '../notifications/notify-by-type';
import { NOTIFICATION_CATALOG } from '../notifications/catalog/notification-catalog';
import { DlVerificationClient, SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';
import { DriverRepository } from './driver.repository';
import { DriverTenantRelationRepository } from './driver-tenant-relation.repository';
import { DriverAuthService } from './driver-auth.service';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import {
  CompleteRegistrationResult,
  DriverIdentitySession,
  RegisterDriverInput,
  RequestJoinTenantInput,
  RespondToInviteInput,
} from './driver-identity.interface';
import { DriverDeviceCaptureInput } from './driver-auth.types';

export interface DriverRelationSummary {
  linkId: string;
  tenantId: string;
  tenantName: string;
  status: DriverTenantRelationEntity['status'];
  initiatedBy: DriverTenantRelationEntity['initiatedBy'];
  createdAt: Date;
}

/**
 * Everything a driver's own (tenant-independent) identity does: phone verification, completing
 * registration details, requesting to join a tenant, and accepting/rejecting a fleet-owner's
 * invite. The tenant-side half of the same workflow (staff inviting a driver, approving/rejecting
 * a join request) lives in DriverService — see its
 * inviteDriverByPhone/approveDriver/rejectDriver/listPendingStaffReview.
 */
export class DriverIdentityService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly dataSource: DataSource,
    private readonly dlVerificationClient: DlVerificationClient,
    private readonly otpService: OtpService,
    private readonly storageService: StorageService,
    private readonly organizationService: OrganizationService,
    private readonly driverAuthService: DriverAuthService,
    private readonly auditService: AuditService,
    private readonly notifyByType: NotifyByType,
  ) {}

  async requestOtp(phoneNumber: string) {
    const normalized = this.normalizePhone(phoneNumber);

    const existing = await this.driverRepository.findByPhoneNumber(normalized);
    if (existing?.registrationSource === 'self') {
      throw new ConflictError('A driver with this phone number is already registered');
    }

    await this.otpService.requestOtpCode({
      phoneNumber: normalized,
      purpose: 'driver-register',
      cooldownSeconds: env.driverLoginOtpResendCooldownSeconds,
    });

    const otpToken = signToken(
      { phoneNumber: normalized, purpose: 'driver-register-otp' },
      env.driverLoginOtpTtlSeconds,
    );

    return {
      otpToken,
      expiresIn: env.driverLoginOtpTtlSeconds,
      message: `OTP sent to ${normalized}`,
    };
  }

  /**
   * Verifies the phone and immediately creates a minimal shell driver profile (if one doesn't
   * already exist — a fleet owner may have invited this phone first, see
   * DriverService.inviteDriverByPhone) and issues a usable identity-scoped session. This is
   * deliberately the point registration becomes "real": a driver who verifies their phone but
   * abandons before calling completeRegistration below still has a profile on file, so next time
   * they open the app they log in (not register again) and land right back on the same
   * incomplete-details screen — see driver-auth.service.ts's verifyOtp, whose existing
   * "0 active relations -> identity session" branch already covers exactly this resumed case.
   */
  async verifyOtp(
    phoneNumber: string,
    otp: string,
    device?: DriverDeviceCaptureInput,
  ): Promise<DriverIdentitySession> {
    try {
      await this.otpService.verifyOtpCode({
        phoneNumber,
        otp,
        purpose: 'driver-register',
        ttlSeconds: env.driverLoginOtpTtlSeconds,
        invalidOtpMessage: 'Invalid OTP',
        tooManyAttemptsMessage: 'Too many incorrect attempts, please request a new OTP',
      });

      let driver = await this.driverRepository.findByPhoneNumber(phoneNumber);
      if (!driver) {
        driver = await this.driverRepository.create({
          fullName: 'Pending driver',
          phoneNumber,
          licenseNumber: null,
          licenseExpiry: null,
          dateOfJoining: null,
          salaryType: null,
          salaryAmount: null,
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
          registrationSource: 'self',
          createdBy: null,
        });
      }

      const { accessToken, refreshToken } = await this.driverAuthService.issueIdentitySession(
        driver.id,
        device,
      );

      return { driverId: driver.id, accessToken, refreshToken };
    } catch (error) {
      rethrow(error, 'Failed to verify registration OTP');
    }
  }

  /**
   * Step-1 preflight for self-registration, before completeRegistration is called — lets the app
   * show the Sarathi verification result (or manual_review) on screen 1 itself, mirroring the
   * staff-side "Add a driver" form's POST /masters/drivers/verify-dl. Read-only: doesn't touch the
   * driver row. completeRegistration runs this same lookup again on submit — that's the one whose
   * result actually gets persisted (as a driver_verifications row); this call is purely so the
   * mobile UI can react to the outcome before the driver taps "Next".
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
   * Screen 1 (mandatory) + screens 2/3 (optional) of the self-registration form. `driverId` comes
   * from the caller's own authenticated token (issued by verifyOtp above, or by a resumed login —
   * see driver-auth.service.ts), never a create-or-claim-by-phone lookup: the shell profile
   * already exists by the time this runs. Callable more than once — a driver who only completed
   * screen 1 the first time can call this again later with screen 2/3 fields to finish up, though
   * both DL photos (front and back) are mandatory before this call can succeed at all — see the
   * cumulative-type check below, no manual_review exemption. License photos are uploaded
   * tenant-lessly beforehand (StorageService.generateUploadUrl(null, ...)) and validated here via
   * getByKeyNullTenant. DL verification runs the same DlVerificationClient staff onboarding uses,
   * behind the same interface.
   */
  async completeRegistration(
    driverId: string,
    input: RegisterDriverInput,
  ): Promise<CompleteRegistrationResult> {
    try {
      const existing = await this.driverRepository.findById(driverId);
      if (!existing) throw new NotFoundError('Driver not found');

      const licenseNumber = input.licenseNumber.toUpperCase();
      const licenseOwner = await this.driverRepository.findByLicenseNumber(licenseNumber);
      if (licenseOwner && licenseOwner.id !== driverId) {
        throw new ConflictError('A driver with this license number already exists');
      }

      // Front and back DL photos are always required now, regardless of Sarathi's verification
      // result — see the cumulative-type check after document creation below, not here.
      // Pre-transaction read, since newDocuments (about to be inserted) aren't visible to a query
      // outside the transaction until it commits.
      const newDocuments = input.documents ?? [];
      const existingDocumentTypes = new Set(
        (await this.driverRepository.listDocuments(driverId)).map((doc) => doc.documentType),
      );

      let licenseVerificationStatus: CompleteRegistrationResult['licenseVerificationStatus'] = null;

      await this.dataSource.transaction(async (manager) => {
        await this.driverRepository.update(
          driverId,
          {
            fullName: input.fullName,
            licenseNumber,
            licenseExpiry: input.licenseExpiry ?? null,
            dateOfBirth: input.dateOfBirth,
            bloodGroup: input.bloodGroup ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            pinCode: input.pinCode ?? null,
            emergencyContactName: input.emergencyContactName ?? null,
            emergencyContactPhone: input.emergencyContactPhone ?? null,
            emergencyContactRelation: input.emergencyContactRelation ?? null,
            hasLifeInsurance: input.hasLifeInsurance ?? false,
            hasHealthInsurance: input.hasHealthInsurance ?? false,
            // No `?? null` here, unlike the fields above — undefined must stay undefined so
            // TypeORM skips this column when the client omits it, preserving whatever step was
            // recorded on a prior call. Coercing to null would overwrite that bookmark on every
            // subsequent call that doesn't resend it, defeating its purpose.
            onboardingStep: input.onboardingStep,
            registrationSource: 'self',
            updatedBy: driverId,
          },
          manager,
        );

        for (const document of newDocuments) {
          const { file } = await this.storageService.getByKeyNullTenant(document.fileUrl);
          if (file.purpose !== 'masters/driver') {
            throw new ConflictError(
              `File ${document.fileUrl} was not uploaded for a driver document`,
            );
          }
          if (file.status !== 'confirmed') {
            throw new ConflictError(
              `File ${document.fileUrl} must be confirmed before it can be attached`,
            );
          }
          await this.driverRepository.createDocument(
            {
              tenantId: null,
              driverId,
              documentType: document.documentType,
              fileUrl: document.fileUrl,
              documentNumber: document.documentNumber ?? null,
              verificationSource: document.verificationSource ?? 'manual',
              verifiedAt: null,
              createdBy: null,
            },
            manager,
          );
        }

        const result = await this.dlVerificationClient.lookupDrivingLicence(
          licenseNumber,
          input.dateOfBirth,
        );
        licenseVerificationStatus = result.status;
        const verified = result.status === 'verified';

        // Both DL photos are mandatory, cumulatively across calls, regardless of whether Sarathi
        // verified the license electronically — no manual_review exemption anymore.
        const cumulativeDocumentTypes = new Set([
          ...existingDocumentTypes,
          ...newDocuments.map((doc) => doc.documentType),
        ]);
        if (
          !cumulativeDocumentTypes.has('driving_license_front') ||
          !cumulativeDocumentTypes.has('driving_license_back')
        ) {
          throw new ValidationError('Driving licence front and back photos are both required');
        }

        await this.driverRepository.createVerification(
          {
            tenantId: null,
            driverId,
            verificationType: 'sarathi_dl',
            verificationStatus: verified ? 'verified' : 'manual_review',
            sourceReference: null,
            holderName: result.holderName ?? null,
            licenseNumber,
            validUntil: result.validUntil ?? null,
            licenseClass: result.licenseClass ?? null,
            licenseStatus: result.licenseStatus ?? null,
            addressLine1: result.addressLine1 ?? null,
            addressLine2: result.addressLine2 ?? null,
            city: result.city ?? null,
            pinCode: result.pinCode ?? null,
            rawResponse: result.rawResponse ?? null,
            verifiedAt: verified ? new Date() : null,
            createdBy: null,
          },
          manager,
        );

        if (verified) {
          await this.driverRepository.update(
            driverId,
            {
              licenseVerified: true,
              licenseExpiry: result.validUntil ?? input.licenseExpiry ?? undefined,
            },
            manager,
          );
        }

        if (input.bankDetails) {
          await this.driverRepository.createBankDetails(
            {
              tenantId: null,
              driverId,
              accountNumber: input.bankDetails.accountNumber,
              ifsc: input.bankDetails.ifsc.toUpperCase(),
              accountHolderName: input.bankDetails.accountHolderName ?? null,
              upiId: input.bankDetails.upiId ?? null,
              createdBy: null,
            },
            manager,
          );
        }
      });

      const driver = await this.driverRepository.findByIdWithPersonRelations(driverId);
      if (!driver) throw new NotFoundError('Driver not found');

      return { driverId, licenseVerificationStatus, driver };
    } catch (error) {
      rethrow(error, 'Failed to complete driver registration');
    }
  }

  async listMyRelations(driverId: string): Promise<DriverRelationSummary[]> {
    try {
      const relations = await this.driverTenantRelationRepository.listByDriver(driverId);
      return await Promise.all(
        relations.map(async (relation) => {
          const organization = await this.organizationService.getOrganizationStatus(
            relation.tenantId,
          );
          return {
            linkId: relation.id,
            tenantId: relation.tenantId,
            tenantName: organization.name ?? '',
            status: relation.status,
            initiatedBy: relation.initiatedBy,
            createdAt: relation.createdAt,
          };
        }),
      );
    } catch (error) {
      rethrow(error, 'Failed to list driver relations');
    }
  }

  /** Driver-initiated: request to join a tenant found via the org-search endpoint. */
  async requestJoin(driverId: string, input: RequestJoinTenantInput) {
    try {
      // Throws NotFoundError if the tenant doesn't exist — the only thing this call needs to do here.
      await this.organizationService.getOrganizationStatus(input.tenantId);

      const existing = await this.driverTenantRelationRepository.findByTenantAndDriver(
        input.tenantId,
        driverId,
      );
      if (existing) {
        throw new ConflictError('A relation with this fleet owner already exists');
      }

      const driver = await this.driverRepository.findById(driverId);
      if (!driver) throw new NotFoundError('Driver not found');

      const relation = await this.driverTenantRelationRepository.create({
        tenantId: input.tenantId,
        driverId,
        status: 'pending_staff_review',
        initiatedBy: 'driver',
        initiatedByUserId: null,
        driverRespondedAt: new Date(),
        fleetOwnerRespondedAt: null,
        approvedBy: null,
        approvedAt: null,
        createdBy: null,
      });

      await this.notifyByType(NOTIFICATION_CATALOG, 'driver.link_requested', input.tenantId, {
        driverName: driver.fullName,
        phoneNumber: driver.phoneNumber,
      }).catch(() => {
        // Best-effort — a notification failure must never fail the join request itself.
      });

      return { linkId: relation.id, status: relation.status };
    } catch (error) {
      rethrow(error, 'Failed to request to join tenant');
    }
  }

  /** Driver accepts/rejects a fleet-owner-initiated invite (`pending_driver_review`). */
  async respondToInvite(driverId: string, relationId: string, input: RespondToInviteInput) {
    try {
      const relation = input.accept
        ? await this.driverTenantRelationRepository.accept(relationId, driverId)
        : await this.driverTenantRelationRepository.declineInvite(
            relationId,
            driverId,
            input.reason ?? null,
          );
      if (!relation) throw new NotFoundError('Invite not found');

      const driver = await this.driverRepository.findById(driverId);

      await this.auditService.log({
        tenantId: relation.tenantId,
        userId: driverId,
        action: input.accept ? 'DRIVER_LINK_ACCEPTED' : 'DRIVER_LINK_DECLINED',
        resourceType: 'driver',
        oldData: { id: relationId, status: 'pending_driver_review' },
        newData: { id: relationId, status: relation.status },
      });

      if (input.accept && driver) {
        await this.notifyByType(NOTIFICATION_CATALOG, 'driver.link_accepted', relation.tenantId, {
          driverName: driver.fullName,
          phoneNumber: driver.phoneNumber,
        }).catch(() => {
          // Best-effort — see requestJoin's note.
        });
      }

      return { linkId: relation.id, status: relation.status, tenantId: relation.tenantId };
    } catch (error) {
      rethrow(error, 'Failed to respond to invite');
    }
  }

  private normalizePhone(phoneNumber: string): string {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      throw new AuthenticationError('phoneNumber is invalid');
    }
    return normalized;
  }
}
