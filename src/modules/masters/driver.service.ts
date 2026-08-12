import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import { DriverBankVerificationStatus } from './utils/drivers.types';
import { DriverRepository } from './driver.repository';
import { Paginated, paginate } from './utils/masters.types';
import { SarathiClient, SarathiDrivingLicenceResult } from './sarathi.client';
import {
  AddBankDetailsInput,
  AddDriverDocumentInput,
  CreateDriverInput,
  ListDriversInput,
  OnboardDriverInput,
  RecordDriverTripMetricsInput,
  RecordVerificationInput,
  SetDriverOperationalStatusInput,
  UpdateDriverInput,
} from './utils/drivers.interface';

export class DriverService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly dataSource: DataSource,
    private readonly sarathiClient: SarathiClient,
  ) {}

  /**
   * Preflight check used by the "Verify the driving licence" step of the Add-a-driver form,
   * before the driver record exists — so this never touches `driverRepository`. The caller (the
   * onboarding form) decides what to do with the result: bundle it into `onboardDriver.verification`
   * on `verified`, or switch to the manual-entry fields (photo uploads + typed-in details) and submit
   * that instead on `manual_review`.
   */
  async checkDrivingLicence(licenseNumber: string): Promise<SarathiDrivingLicenceResult> {
    try {
      return await this.sarathiClient.lookupDrivingLicence(licenseNumber);
    } catch (error) {
      rethrow(error, 'Failed to check driving licence against Sarathi');
    }
  }

  /** Only called internally, by onboardDriver — there is no standalone create-driver route. */
  private async createDriver(
    tenantId: string,
    actorId: string,
    input: CreateDriverInput,
    manager?: EntityManager,
  ): Promise<DriverEntity> {
    try {
      const existing = await this.driverRepository.findByPhoneNumber(tenantId, input.phoneNumber);
      if (existing) {
        throw new ConflictError('A driver with this phone number already exists');
      }

      return await this.driverRepository.create(
        {
          tenantId,
          fullName: input.fullName,
          phoneNumber: input.phoneNumber,
          licenseNumber: input.licenseNumber?.toUpperCase() ?? null,
          licenseExpiry: input.licenseExpiry ?? null,
          dateOfJoining: input.dateOfJoining ?? null,
          createdBy: actorId,
        },
        manager,
      );
    } catch (error) {
      rethrow(error, 'Failed to create driver');
    }
  }

  async listDrivers(tenantId: string, input: ListDriversInput): Promise<Paginated<DriverEntity>> {
    try {
      const { items, total } = await this.driverRepository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list drivers');
    }
  }

  async getDriver(tenantId: string, driverId: string): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithRelations(tenantId, driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver');
    }
  }

  async updateDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: UpdateDriverInput,
  ): Promise<DriverEntity> {
    try {
      const existing = await this.assertDriverExists(tenantId, driverId);
      const licenseNumber = input.licenseNumber?.toUpperCase();
      const licenseChanged =
        licenseNumber !== undefined && licenseNumber !== existing.licenseNumber;

      const driver = await this.driverRepository.update(tenantId, driverId, {
        ...input,
        licenseNumber,
        licenseVerified: licenseChanged ? false : undefined,
        updatedBy: actorId,
      });
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, 'Failed to update driver');
    }
  }

  async deleteDriver(tenantId: string, actorId: string, driverId: string): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.driverRepository.softDelete(tenantId, driverId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver');
    }
  }

  async addDocument(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: AddDriverDocumentInput,
  ): Promise<DriverDocumentEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);

      const verificationSource = input.verificationSource ?? 'manual';
      return await this.driverRepository.createDocument({
        tenantId,
        driverId,
        documentType: input.documentType,
        fileUrl: input.fileUrl,
        verificationSource,
        verifiedAt: null,
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add driver document');
    }
  }

  async listDocuments(tenantId: string, driverId: string): Promise<DriverDocumentEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listDocuments(tenantId, driverId);
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
      const existing = await this.driverRepository.findDocumentById(tenantId, driverId, documentId);
      if (!existing) throw new NotFoundError(`Driver document ${documentId} not found`);
      await this.driverRepository.softDeleteDocument(tenantId, driverId, documentId, actorId);
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
            tenantId,
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
      return await this.driverRepository.listVerifications(tenantId, driverId);
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
        tenantId,
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
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add driver bank details');
    }
  }

  async listBankDetails(tenantId: string, driverId: string): Promise<DriverBankDetailsEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listBankDetails(tenantId, driverId);
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
      const existing = await this.driverRepository.findBankDetailsById(
        tenantId,
        driverId,
        bankDetailsId,
      );
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);

      const bankDetails = await this.driverRepository.updateBankDetailsVerification(
        tenantId,
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
      const existing = await this.driverRepository.findBankDetailsById(
        tenantId,
        driverId,
        bankDetailsId,
      );
      if (!existing) throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      await this.driverRepository.softDeleteBankDetails(tenantId, driverId, bankDetailsId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver bank details');
    }
  }

  async getOperationalStatus(
    tenantId: string,
    driverId: string,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);

      const status = await this.driverRepository.findOperationalStatus(tenantId, driverId);
      if (!status) throw new NotFoundError(`Driver ${driverId} has no operational status yet`);
      return status;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver operational status');
    }
  }

  /** One row per driver, so the first call inserts and later calls overwrite it. */
  async setOperationalStatus(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: SetDriverOperationalStatusInput,
    manager?: EntityManager,
  ): Promise<DriverOperationalStatusEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId, manager);

      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const existing = await this.driverRepository.findOperationalStatus(tenantId, driverId);

      if (!existing) {
        return await this.driverRepository.createOperationalStatus(
          {
            tenantId,
            driverId,
            operationalStatus: input.operationalStatus,
            reason: input.reason ?? null,
            effectiveAt,
            createdBy: actorId,
          },
          manager,
        );
      }

      const status = await this.driverRepository.updateOperationalStatus(tenantId, driverId, {
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
      await this.assertDriverExists(tenantId, driverId);

      if (input.periodEnd < input.periodStart) {
        throw new ValidationError('periodEnd must not be earlier than periodStart');
      }

      const onTimePercentage = String(input.onTimePercentage);
      const existing = await this.driverRepository.findTripMetricsByPeriod(
        tenantId,
        driverId,
        input.periodStart,
        input.periodEnd,
      );

      if (!existing) {
        return await this.driverRepository.createTripMetrics({
          tenantId,
          driverId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          tripsCount: input.tripsCount,
          onTimePercentage,
          createdBy: actorId,
        });
      }

      const metrics = await this.driverRepository.updateTripMetrics(tenantId, existing.id, {
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
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listTripMetrics(tenantId, driverId);
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
    input: OnboardDriverInput,
  ): Promise<DriverEntity> {
    try {
      const { verification, bankDetails, documents, operationalStatus, ...driverInput } = input;

      const driverId = await this.dataSource.transaction(async (manager) => {
        const driver = await this.createDriver(tenantId, actorId, driverInput, manager);

        if (verification) {
          await this.recordVerification(tenantId, actorId, driver.id, verification, manager);
        }

        for (const document of documents ?? []) {
          await this.driverRepository.createDocument(
            {
              tenantId,
              driverId: driver.id,
              documentType: document.documentType,
              fileUrl: document.fileUrl,
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
   * Shared by this service and the fleet-link service, which needs the driver to exist before linking.
   * Callers inside a transaction must pass the manager, or the read runs on another connection and
   * cannot see a driver created moments earlier in the same uncommitted transaction.
   */
  async assertDriverExists(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findById(tenantId, driverId, manager);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, 'Failed to verify driver exists');
    }
  }
}
