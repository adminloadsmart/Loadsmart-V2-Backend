import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { DriverEntity } from './entities/driver.entity';
import { DriverDocumentEntity } from './entities/driver-document.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { DriverBankDetailsEntity } from './entities/driver-bank-details.entity';
import { DriverBankVerificationStatus } from './utils/drivers.types';
import {
  CreateDriverBankDetailsData,
  CreateDriverData,
  CreateDriverDocumentData,
  CreateDriverVerificationData,
  ListDriversFilters,
  UpdateDriverData,
} from './utils/drivers.interface';

export class DriverRepository {
  private readonly drivers: Repository<DriverEntity>;
  private readonly documents: Repository<DriverDocumentEntity>;
  private readonly verifications: Repository<DriverVerificationEntity>;
  private readonly bankDetails: Repository<DriverBankDetailsEntity>;

  constructor(dataSource: DataSource) {
    this.drivers = dataSource.getRepository(DriverEntity);
    this.documents = dataSource.getRepository(DriverDocumentEntity);
    this.verifications = dataSource.getRepository(DriverVerificationEntity);
    this.bankDetails = dataSource.getRepository(DriverBankDetailsEntity);
  }

  async create(data: CreateDriverData, manager?: EntityManager): Promise<DriverEntity> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    const driver = drivers.create({ ...data, deletedAt: null });
    return drivers.save(driver);
  }

  findById(tenantId: string, id: string): Promise<DriverEntity | null> {
    return this.drivers.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findByIdWithRelations(tenantId: string, id: string): Promise<DriverEntity | null> {
    return this.drivers.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { documents: true, verifications: true, bankDetails: true, vehicleLinks: { vehicle: true } },
    });
  }

  findByPhoneNumber(tenantId: string, phoneNumber: string): Promise<DriverEntity | null> {
    return this.drivers.findOneBy({ tenantId, phoneNumber, deletedAt: IsNull() });
  }

  async list(tenantId: string, filters: ListDriversFilters): Promise<{ items: DriverEntity[]; total: number }> {
    const { status, search, page, limit } = filters;

    const base: FindOptionsWhere<DriverEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;

    // Search spans two columns, so it becomes two OR'd where-clauses rather than one.
    const where: FindOptionsWhere<DriverEntity>[] = search
      ? [
        { ...base, fullName: ILike(`%${search}%`) },
        { ...base, phoneNumber: ILike(`%${search}%`) },
      ]
      : [base];

    const [items, total] = await this.drivers.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async update(tenantId: string, id: string, data: UpdateDriverData, manager?: EntityManager): Promise<DriverEntity | null> {
    const drivers = manager ? manager.getRepository(DriverEntity) : this.drivers;
    await drivers.update({ id, tenantId, deletedAt: IsNull() }, data);
    return drivers.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.drivers.update({ id, tenantId, deletedAt: IsNull() }, { deletedAt: new Date(), updatedBy: deletedBy });
  }

  async createDocument(data: CreateDriverDocumentData): Promise<DriverDocumentEntity> {
    const document = this.documents.create({ ...data, deletedAt: null });
    return this.documents.save(document);
  }

  findDocumentById(tenantId: string, driverId: string, id: string): Promise<DriverDocumentEntity | null> {
    return this.documents.findOneBy({ id, driverId, tenantId, deletedAt: IsNull() });
  }

  listDocuments(tenantId: string, driverId: string): Promise<DriverDocumentEntity[]> {
    return this.documents.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async softDeleteDocument(tenantId: string, driverId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.documents.update(
      { id, driverId, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  async createVerification(data: CreateDriverVerificationData, manager?: EntityManager): Promise<DriverVerificationEntity> {
    const verifications = manager ? manager.getRepository(DriverVerificationEntity) : this.verifications;
    const verification = verifications.create({ ...data, deletedAt: null });
    return verifications.save(verification);
  }

  listVerifications(tenantId: string, driverId: string): Promise<DriverVerificationEntity[]> {
    return this.verifications.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async createBankDetails(data: CreateDriverBankDetailsData): Promise<DriverBankDetailsEntity> {
    const bankDetails = this.bankDetails.create({ ...data, deletedAt: null });
    return this.bankDetails.save(bankDetails);
  }

  findBankDetailsById(tenantId: string, driverId: string, id: string): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({ id, driverId, tenantId, deletedAt: IsNull() });
  }

  findBankDetailsByAccount(tenantId: string, driverId: string, accountNumber: string, ifsc: string): Promise<DriverBankDetailsEntity | null> {
    return this.bankDetails.findOneBy({ tenantId, driverId, accountNumber, ifsc, deletedAt: IsNull() });
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
    data: { verificationStatus: DriverBankVerificationStatus; verifiedAt: Date | null; updatedBy: string | null },
  ): Promise<DriverBankDetailsEntity | null> {
    await this.bankDetails.update({ id, driverId, tenantId, deletedAt: IsNull() }, data);
    return this.findBankDetailsById(tenantId, driverId, id);
  }

  async softDeleteBankDetails(tenantId: string, driverId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.bankDetails.update(
      { id, driverId, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }
}
