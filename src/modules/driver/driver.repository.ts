import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import { DriverBankVerificationStatus } from './drivers.types';
import {
  CreateDriverBankDetailsData,
  CreateDriverDocumentData,
  CreateDriverOperationalStatusData,
  CreateDriverProfileData,
  CreateDriverTripMetricsData,
  CreateDriverVerificationData,
  UpdateDriverOperationalStatusData,
  UpdateDriverProfileData,
  UpdateDriverTripMetricsData,
} from './drivers.interface';

/**
 * Person-level driver data — the global profile (masters.drivers) and everything hung off it
 * directly (documents, verifications, bank details). None of this is tenant-scoped: a document
 * uploaded while onboarding at one tenant is visible to every tenant the driver later links to.
 * `tenantId` is still recorded on create as a non-enforced "originating tenant" audit column.
 * Tenant-scoped employment data (salary, approval status, operational status, trip metrics) lives
 * in DriverTenantRelationRepository / driver_tenant_relations instead.
 */
export class DriverRepository {
  private readonly drivers: Repository<DriverEntity>;
  private readonly documents: Repository<DriverDocumentEntity>;
  private readonly verifications: Repository<DriverVerificationEntity>;
  private readonly bankDetails: Repository<DriverBankDetailsEntity>;
  private readonly operationalStatuses: Repository<DriverOperationalStatusEntity>;
  private readonly tripMetrics: Repository<DriverTripMetricsEntity>;

  constructor(dataSource: DataSource) {
    this.drivers = dataSource.getRepository(DriverEntity);
    this.documents = dataSource.getRepository(DriverDocumentEntity);
    this.verifications = dataSource.getRepository(DriverVerificationEntity);
    this.bankDetails = dataSource.getRepository(DriverBankDetailsEntity);
    this.operationalStatuses = dataSource.getRepository(DriverOperationalStatusEntity);
    this.tripMetrics = dataSource.getRepository(DriverTripMetricsEntity);
  }

  async create(data: CreateDriverProfileData, manager?: EntityManager): Promise<DriverEntity> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    const driver = drivers.create({ ...data, deletedAt: null });
    return drivers.save(driver);
  }

  findById(id: string, manager?: EntityManager): Promise<DriverEntity | null> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    return drivers.findOneBy({ id, deletedAt: IsNull() });
  }

  findByIdWithPersonRelations(id: string): Promise<DriverEntity | null> {
    return this.drivers.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { documents: true, verifications: true, bankDetails: true },
    });
  }

  // Global natural key — a phone/license number identifies at most one driver profile, period.
  findByPhoneNumber(phoneNumber: string): Promise<DriverEntity | null> {
    return this.drivers.findOneBy({ phoneNumber, deletedAt: IsNull() });
  }

  findByLicenseNumber(licenseNumber: string): Promise<DriverEntity | null> {
    return this.drivers.findOneBy({ licenseNumber, deletedAt: IsNull() });
  }

  async update(
    id: string,
    data: UpdateDriverProfileData,
    manager?: EntityManager,
  ): Promise<DriverEntity | null> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    await drivers.update({ id, deletedAt: IsNull() }, data);
    return drivers.findOneBy({ id, deletedAt: IsNull() });
  }

  async createDocument(
    data: CreateDriverDocumentData,
    manager?: EntityManager,
  ): Promise<DriverDocumentEntity> {
    const documents = manager ? manager.getRepository(DriverDocumentEntity) : this.documents;
    const document = documents.create({ ...data, deletedAt: null });
    return documents.save(document);
  }

  findDocumentById(driverId: string, id: string): Promise<DriverDocumentEntity | null> {
    return this.documents.findOneBy({ id, driverId, deletedAt: IsNull() });
  }

  listDocuments(driverId: string): Promise<DriverDocumentEntity[]> {
    return this.documents.find({
      where: { driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async softDeleteDocument(driverId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.documents.update(
      { id, driverId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  async createVerification(
    data: CreateDriverVerificationData,
    manager?: EntityManager,
  ): Promise<DriverVerificationEntity> {
    const verifications = manager
      ? manager.getRepository(DriverVerificationEntity)
      : this.verifications;
    const verification = verifications.create({ ...data, deletedAt: null });
    return verifications.save(verification);
  }

  listVerifications(driverId: string): Promise<DriverVerificationEntity[]> {
    return this.verifications.find({
      where: { driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async createBankDetails(
    data: CreateDriverBankDetailsData,
    manager?: EntityManager,
  ): Promise<DriverBankDetailsEntity> {
    const bank = manager ? manager.getRepository(DriverBankDetailsEntity) : this.bankDetails;
    const bankDetails = bank.create({ ...data, deletedAt: null });
    return bank.save(bankDetails);
  }

  findBankDetailsById(driverId: string, id: string): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({ id, driverId, deletedAt: IsNull() });
  }

  findBankDetailsByAccount(
    driverId: string,
    accountNumber: string,
    ifsc: string,
  ): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({ driverId, accountNumber, ifsc, deletedAt: IsNull() });
  }

  listBankDetails(driverId: string): Promise<DriverBankDetailsEntity[]> {
    return this.bankDetails.find({
      where: { driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async updateBankDetailsVerification(
    driverId: string,
    id: string,
    data: {
      verificationStatus: DriverBankVerificationStatus;
      verifiedAt: Date | null;
      updatedBy: string | null;
    },
  ): Promise<DriverBankDetailsEntity | null> {
    await this.bankDetails.update({ id, driverId, deletedAt: IsNull() }, data);
    return this.findBankDetailsById(driverId, id);
  }

  async softDeleteBankDetails(
    driverId: string,
    id: string,
    deletedBy: string | null,
  ): Promise<void> {
    await this.bankDetails.update(
      { id, driverId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  findOperationalStatus(
    driverTenantRelationId: string,
  ): Promise<DriverOperationalStatusEntity | null> {
    return this.operationalStatuses.findOneBy({ driverTenantRelationId, deletedAt: IsNull() });
  }

  async createOperationalStatus(
    data: CreateDriverOperationalStatusData,
    manager?: EntityManager,
  ): Promise<DriverOperationalStatusEntity> {
    const statuses = manager
      ? manager.getRepository(DriverOperationalStatusEntity)
      : this.operationalStatuses;
    const status = statuses.create({ ...data, deletedAt: null });
    return statuses.save(status);
  }

  async updateOperationalStatus(
    driverTenantRelationId: string,
    data: UpdateDriverOperationalStatusData,
  ): Promise<DriverOperationalStatusEntity | null> {
    await this.operationalStatuses.update({ driverTenantRelationId, deletedAt: IsNull() }, data);
    return this.findOperationalStatus(driverTenantRelationId);
  }

  findTripMetricsByPeriod(
    driverTenantRelationId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<DriverTripMetricsEntity | null> {
    return this.tripMetrics.findOneBy({
      driverTenantRelationId,
      periodStart,
      periodEnd,
      deletedAt: IsNull(),
    });
  }

  async createTripMetrics(data: CreateDriverTripMetricsData): Promise<DriverTripMetricsEntity> {
    const metrics = this.tripMetrics.create({ ...data, deletedAt: null });
    return this.tripMetrics.save(metrics);
  }

  async updateTripMetrics(
    id: string,
    data: UpdateDriverTripMetricsData,
  ): Promise<DriverTripMetricsEntity | null> {
    await this.tripMetrics.update({ id, deletedAt: IsNull() }, data);
    return this.tripMetrics.findOneBy({ id, deletedAt: IsNull() });
  }

  listTripMetrics(driverTenantRelationId: string): Promise<DriverTripMetricsEntity[]> {
    return this.tripMetrics.find({
      where: { driverTenantRelationId, deletedAt: IsNull() },
      order: { periodStart: 'DESC' },
    });
  }
}

// Re-exported so call sites that only need the `search` helper don't need to import TypeORM directly.
export const driverSearchWhere = (
  base: FindOptionsWhere<DriverEntity>,
  search: string,
): FindOptionsWhere<DriverEntity>[] => [
  { ...base, fullName: ILike(`%${search}%`) },
  { ...base, phoneNumber: ILike(`%${search}%`) },
];
