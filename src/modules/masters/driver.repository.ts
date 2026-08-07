import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from './entities/driver-trip-metrics.entity';
import { DriverBankVerificationStatus } from './utils/drivers.types';
import {
  CreateDriverBankDetailsData,
  CreateDriverData,
  CreateDriverDocumentData,
  CreateDriverOperationalStatusData,
  CreateDriverTripMetricsData,
  CreateDriverVerificationData,
  ListDriversFilters,
  UpdateDriverData,
  UpdateDriverOperationalStatusData,
  UpdateDriverTripMetricsData,
} from './utils/drivers.interface';

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

  async create(data: CreateDriverData, manager?: EntityManager): Promise<DriverEntity> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    const driver = drivers.create({ ...data, deletedAt: null });
    return drivers.save(driver);
  }

  findById(tenantId: string, id: string, manager?: EntityManager): Promise<DriverEntity | null> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    return drivers.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findByIdWithRelations(tenantId: string, id: string): Promise<DriverEntity | null> {
    return this.drivers.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: {
        documents: true,
        verifications: true,
        bankDetails: true,
        vehicleLinks: { vehicle: true },
      },
    });
  }

  findByPhoneNumber(tenantId: string, phoneNumber: string): Promise<DriverEntity | null> {
    return this.drivers.findOneBy({ tenantId, phoneNumber, deletedAt: IsNull() });
  }

  async list(
    tenantId: string,
    filters: ListDriversFilters,
  ): Promise<{ items: DriverEntity[]; total: number }> {
    const { status, operationalStatus, search, page, limit } = filters;

    const base: FindOptionsWhere<DriverEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;
    // The drivers table filters on the satellite row ("On trip" / "On leave"), not the lifecycle status.
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };

    // Search spans two columns, so it becomes two OR'd where-clauses rather than one.
    const where: FindOptionsWhere<DriverEntity>[] = search
      ? [
          { ...base, fullName: ILike(`%${search}%`) },
          { ...base, phoneNumber: ILike(`%${search}%`) },
        ]
      : [base];

    // The table renders DL verification, status and trip figures per row, so load them with the page
    // rather than leaving the caller to fan out one request per driver.
    const [items, total] = await this.drivers.findAndCount({
      where,
      relations: { operationalStatus: true, tripMetrics: true, verifications: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateDriverData,
    manager?: EntityManager,
  ): Promise<DriverEntity | null> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    await drivers.update({ id, tenantId, deletedAt: IsNull() }, data);
    return drivers.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.drivers.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  async createDocument(
    data: CreateDriverDocumentData,
    manager?: EntityManager,
  ): Promise<DriverDocumentEntity> {
    const documents = manager ? manager.getRepository(DriverDocumentEntity) : this.documents;
    const document = documents.create({ ...data, deletedAt: null });
    return documents.save(document);
  }

  findDocumentById(
    tenantId: string,
    driverId: string,
    id: string,
  ): Promise<DriverDocumentEntity | null> {
    return this.documents.findOneBy({ id, driverId, tenantId, deletedAt: IsNull() });
  }

  listDocuments(tenantId: string, driverId: string): Promise<DriverDocumentEntity[]> {
    return this.documents.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async softDeleteDocument(
    tenantId: string,
    driverId: string,
    id: string,
    deletedBy: string | null,
  ): Promise<void> {
    await this.documents.update(
      { id, driverId, tenantId, deletedAt: IsNull() },
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

  listVerifications(tenantId: string, driverId: string): Promise<DriverVerificationEntity[]> {
    return this.verifications.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
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

  findBankDetailsById(
    tenantId: string,
    driverId: string,
    id: string,
  ): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({ id, driverId, tenantId, deletedAt: IsNull() });
  }

  findBankDetailsByAccount(
    tenantId: string,
    driverId: string,
    accountNumber: string,
    ifsc: string,
  ): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({
      tenantId,
      driverId,
      accountNumber,
      ifsc,
      deletedAt: IsNull(),
    });
  }

  listBankDetails(tenantId: string, driverId: string): Promise<DriverBankDetailsEntity[]> {
    return this.bankDetails.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async updateBankDetailsVerification(
    tenantId: string,
    driverId: string,
    id: string,
    data: {
      verificationStatus: DriverBankVerificationStatus;
      verifiedAt: Date | null;
      updatedBy: string | null;
    },
  ): Promise<DriverBankDetailsEntity | null> {
    await this.bankDetails.update({ id, driverId, tenantId, deletedAt: IsNull() }, data);
    return this.findBankDetailsById(tenantId, driverId, id);
  }

  async softDeleteBankDetails(
    tenantId: string,
    driverId: string,
    id: string,
    deletedBy: string | null,
  ): Promise<void> {
    await this.bankDetails.update(
      { id, driverId, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  findOperationalStatus(
    tenantId: string,
    driverId: string,
  ): Promise<DriverOperationalStatusEntity | null> {
    return this.operationalStatuses.findOneBy({ tenantId, driverId, deletedAt: IsNull() });
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
    tenantId: string,
    driverId: string,
    data: UpdateDriverOperationalStatusData,
  ): Promise<DriverOperationalStatusEntity | null> {
    await this.operationalStatuses.update({ tenantId, driverId, deletedAt: IsNull() }, data);
    return this.findOperationalStatus(tenantId, driverId);
  }

  findTripMetricsByPeriod(
    tenantId: string,
    driverId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<DriverTripMetricsEntity | null> {
    return this.tripMetrics.findOneBy({
      tenantId,
      driverId,
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
    tenantId: string,
    id: string,
    data: UpdateDriverTripMetricsData,
  ): Promise<DriverTripMetricsEntity | null> {
    await this.tripMetrics.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.tripMetrics.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  listTripMetrics(tenantId: string, driverId: string): Promise<DriverTripMetricsEntity[]> {
    return this.tripMetrics.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { periodStart: 'DESC' },
    });
  }
}
