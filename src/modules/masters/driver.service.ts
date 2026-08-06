import { DataSource } from "typeorm";
import { ConflictError, NotFoundError, rethrow } from "../../shared/errors";
import { DriverEntity } from "./entities/driver.entity";
import { DriverDocumentEntity } from "./entities/driver-document.entity";
import { DriverVerificationEntity } from "./entities/driver-verification.entity";
import { DriverBankDetailsEntity } from "./entities/driver-bank-details.entity";
import { DriverBankVerificationStatus } from "./utils/drivers.types";
import { DriverRepository } from "./driver.repository";
import { Paginated, paginate } from "./utils/masters.types";
import {
  AddBankDetailsInput,
  AddDriverDocumentInput,
  CreateDriverInput,
  ListDriversInput,
  RecordVerificationInput,
  UpdateDriverInput,
} from "./utils/drivers.interface";

export class DriverService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly dataSource: DataSource,
  ) {}

  async createDriver(
    tenantId: string,
    actorId: string,
    input: CreateDriverInput,
  ): Promise<DriverEntity> {
    try {
      const existing = await this.driverRepository.findByPhoneNumber(
        tenantId,
        input.phoneNumber,
      );
      if (existing) {
        throw new ConflictError("A driver with this phone number already exists");
      }

      return await this.driverRepository.create({
        tenantId,
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        licenseNumber: input.licenseNumber?.toUpperCase() ?? null,
        licenseExpiry: input.licenseExpiry ?? null,
        dateOfJoining: input.dateOfJoining ?? null,
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, "Failed to create driver");
    }
  }

  async listDrivers(
    tenantId: string,
    input: ListDriversInput,
  ): Promise<Paginated<DriverEntity>> {
    try {
      const { items, total } = await this.driverRepository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, "Failed to list drivers");
    }
  }

  async getDriver(tenantId: string, driverId: string): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithRelations(
        tenantId,
        driverId,
      );
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, "Failed to fetch driver");
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

      // Editing the licence number invalidates whatever verification the old number carried.
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
      rethrow(error, "Failed to update driver");
    }
  }

  async deleteDriver(
    tenantId: string,
    actorId: string,
    driverId: string,
  ): Promise<void> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      await this.driverRepository.softDelete(tenantId, driverId, actorId);
    } catch (error) {
      rethrow(error, "Failed to delete driver");
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

      const verificationSource = input.verificationSource ?? "manual";
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
      rethrow(error, "Failed to add driver document");
    }
  }

  async listDocuments(
    tenantId: string,
    driverId: string,
  ): Promise<DriverDocumentEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listDocuments(tenantId, driverId);
    } catch (error) {
      rethrow(error, "Failed to list driver documents");
    }
  }

  async deleteDocument(
    tenantId: string,
    actorId: string,
    driverId: string,
    documentId: string,
  ): Promise<void> {
    try {
      const existing = await this.driverRepository.findDocumentById(
        tenantId,
        driverId,
        documentId,
      );
      if (!existing)
        throw new NotFoundError(`Driver document ${documentId} not found`);
      await this.driverRepository.softDeleteDocument(
        tenantId,
        driverId,
        documentId,
        actorId,
      );
    } catch (error) {
      rethrow(error, "Failed to delete driver document");
    }
  }

  async recordVerification(
    tenantId: string,
    actorId: string,
    driverId: string,
    input: RecordVerificationInput,
  ): Promise<DriverVerificationEntity> {
    try {
      await this.assertDriverExists(tenantId, driverId);

      const verified = input.verificationStatus === "verified";
      const licenseNumber = input.licenseNumber?.toUpperCase() ?? null;

      return await this.dataSource.transaction(async (manager) => {
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
      });
    } catch (error) {
      rethrow(error, "Failed to record driver verification");
    }
  }

  async listVerifications(
    tenantId: string,
    driverId: string,
  ): Promise<DriverVerificationEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listVerifications(tenantId, driverId);
    } catch (error) {
      rethrow(error, "Failed to list driver verifications");
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
        throw new ConflictError(
          "This bank account is already on file for the driver",
        );
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
      rethrow(error, "Failed to add driver bank details");
    }
  }

  async listBankDetails(
    tenantId: string,
    driverId: string,
  ): Promise<DriverBankDetailsEntity[]> {
    try {
      await this.assertDriverExists(tenantId, driverId);
      return await this.driverRepository.listBankDetails(tenantId, driverId);
    } catch (error) {
      rethrow(error, "Failed to list driver bank details");
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
      if (!existing)
        throw new NotFoundError(`Bank details ${bankDetailsId} not found`);

      const bankDetails =
        await this.driverRepository.updateBankDetailsVerification(
          tenantId,
          driverId,
          bankDetailsId,
          {
            verificationStatus,
            verifiedAt: verificationStatus === "verified" ? new Date() : null,
            updatedBy: actorId,
          },
        );
      if (!bankDetails)
        throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      return bankDetails;
    } catch (error) {
      rethrow(error, "Failed to update driver bank details verification");
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
      if (!existing)
        throw new NotFoundError(`Bank details ${bankDetailsId} not found`);
      await this.driverRepository.softDeleteBankDetails(
        tenantId,
        driverId,
        bankDetailsId,
        actorId,
      );
    } catch (error) {
      rethrow(error, "Failed to delete driver bank details");
    }
  }

  /** Shared by this service and the fleet-link service, which needs the driver to exist before linking. */
  async assertDriverExists(
    tenantId: string,
    driverId: string,
  ): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findById(tenantId, driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, "Failed to verify driver exists");
    }
  }
}
