import { Brackets, DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadingPointEntity } from '../../masters/loading-point/entities/loading-point.entity';
import { ProductEntity } from '../../masters/product/entities/product.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { TruckTypeEntity } from '../../masters/truck-type/entities/truck-type.entity';
import { LoadPostingEntity } from './entities/load-posting.entity';
import { LoadRecipientEntity } from './entities/load-recipient.entity';
import { LoadDraftEntity } from './entities/load-draft.entity';
import { CustomerContractEntity } from './entities/customer-contract.entity';
import { MessageStatus, RecipientType } from './utils/load-posting.types';

export type CreatePostingData = Omit<LoadPostingEntity, 'id' | 'createdAt' | 'updatedAt'>;

export interface CreateRecipientData {
  tenantId: string;
  postingId: string;
  recipientType: RecipientType;
  transporterId: string | null;
}

/**
 * All data access for Post a load — TypeORM Repository/QueryBuilder only. Read helpers that back
 * the form's pickers (customers, saved addresses, commodities, transporters, truck types) query
 * the master tables directly, tenant-scoped and soft-delete aware, the same "reporting-style read
 * across masters" approach analytics repositories take; writes to masters still go through their
 * own repositories/services.
 */
export class LoadPostingRepository {
  private readonly postings: Repository<LoadPostingEntity>;
  private readonly recipients: Repository<LoadRecipientEntity>;
  private readonly drafts: Repository<LoadDraftEntity>;
  private readonly contracts: Repository<CustomerContractEntity>;
  private readonly customers: Repository<CustomerEntity>;
  private readonly deliveryPoints: Repository<CustomerDeliveryPointEntity>;
  private readonly loadingPoints: Repository<LoadingPointEntity>;
  private readonly products: Repository<ProductEntity>;
  private readonly transporters: Repository<TransporterEntity>;
  private readonly truckTypes: Repository<TruckTypeEntity>;

  constructor(dataSource: DataSource) {
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.recipients = dataSource.getRepository(LoadRecipientEntity);
    this.drafts = dataSource.getRepository(LoadDraftEntity);
    this.contracts = dataSource.getRepository(CustomerContractEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.deliveryPoints = dataSource.getRepository(CustomerDeliveryPointEntity);
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
    this.products = dataSource.getRepository(ProductEntity);
    this.transporters = dataSource.getRepository(TransporterEntity);
    this.truckTypes = dataSource.getRepository(TruckTypeEntity);
  }

  // --- Postings ---

  async createPosting(data: CreatePostingData, manager: EntityManager): Promise<LoadPostingEntity> {
    const repo = manager.getRepository(LoadPostingEntity);
    return repo.save(repo.create(data));
  }

  findPostingByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.postings.findOneBy({ tenantId, idempotencyKey });
  }

  findPostingById(tenantId: string, id: string, manager?: EntityManager) {
    return (manager?.getRepository(LoadPostingEntity) ?? this.postings).findOneBy({ id, tenantId });
  }

  /** Newest postings first — the source for recent customers and past-load cards. */
  listRecentPostings(tenantId: string, customerId: string | null, take: number) {
    return this.postings.find({
      where: { tenantId, customerId: customerId ?? IsNull() },
      order: { createdAt: 'DESC' },
      take,
    });
  }

  /** Postings with a customer, newest first — recent-customers distinct-by-customer in JS. */
  listRecentPostingsWithCustomer(tenantId: string, take: number) {
    return this.postings
      .createQueryBuilder('posting')
      .where('posting.tenant_id = :tenantId', { tenantId })
      .andWhere('posting.customer_id IS NOT NULL')
      .orderBy('posting.created_at', 'DESC')
      .take(take)
      .getMany();
  }

  // --- Recipients ---

  async createRecipients(
    rows: CreateRecipientData[],
    manager: EntityManager,
  ): Promise<LoadRecipientEntity[]> {
    const repo = manager.getRepository(LoadRecipientEntity);
    return repo.save(repo.create(rows));
  }

  listRecipients(tenantId: string, postingId: string, manager?: EntityManager) {
    return (manager?.getRepository(LoadRecipientEntity) ?? this.recipients).find({
      where: { tenantId, postingId },
      relations: { transporter: true },
      order: { createdAt: 'ASC' },
    });
  }

  async setRecipientStatus(
    tenantId: string,
    recipientId: string,
    status: MessageStatus,
    sentAt: Date | null,
  ): Promise<void> {
    await this.recipients.update({ id: recipientId, tenantId }, { messageStatus: status, sentAt });
  }

  // --- Customers ---

  findCustomers(tenantId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([] as CustomerEntity[]);
    return this.customers.find({ where: { tenantId, id: In(ids), deletedAt: IsNull() } });
  }

  /** Search the Customer master by name or customer code, anywhere in the text, ignoring case
   *  (PL-02). Rejected customers never show; each row carries its unloading-point count. */
  async searchCustomers(tenantId: string, search: string | undefined, limit: number) {
    const query = this.customers
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.deliveryPoints', 'point', 'point.deleted_at IS NULL')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.deleted_at IS NULL')
      .andWhere("customer.status IN ('active', 'pending')");
    if (search) {
      query.andWhere(
        new Brackets((qb) =>
          qb
            .where('customer.name ILIKE :search', { search: `%${search}%` })
            .orWhere('customer.code ILIKE :search', { search: `%${search}%` }),
        ),
      );
    }
    return query.orderBy('customer.name', 'ASC').take(limit).getMany();
  }

  findCustomerByExactName(tenantId: string, name: string) {
    return this.customers
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.deleted_at IS NULL')
      .andWhere('LOWER(customer.name) = LOWER(:name)', { name })
      .getOne();
  }

  // --- Addresses ---

  listUnloadingPoints(tenantId: string, customerId: string, search?: string) {
    const query = this.deliveryPoints
      .createQueryBuilder('point')
      .where('point.tenant_id = :tenantId', { tenantId })
      .andWhere('point.customer_id = :customerId', { customerId })
      .andWhere('point.deleted_at IS NULL');
    if (search) {
      query.andWhere(
        new Brackets((qb) =>
          qb
            .where('point.location ILIKE :search', { search: `%${search}%` })
            .orWhere('point.address_line_1 ILIKE :search', { search: `%${search}%` })
            .orWhere('point.pin_code ILIKE :search', { search: `%${search}%` }),
        ),
      );
    }
    return query.orderBy('point.location', 'ASC').take(25).getMany();
  }

  findUnloadingPoint(tenantId: string, customerId: string, id: string) {
    return this.deliveryPoints.findOneBy({ id, tenantId, customerId, deletedAt: IsNull() });
  }

  /** Loading point master — name, address or pincode (PL-09). Active and pending both show, a new
   *  pickup the shipper just added is pending until an org admin approves it. */
  searchLoadingPoints(tenantId: string, search?: string) {
    const query = this.loadingPoints
      .createQueryBuilder('point')
      .where('point.tenant_id = :tenantId', { tenantId })
      .andWhere('point.deleted_at IS NULL')
      .andWhere("point.status IN ('active', 'pending')");
    if (search) {
      query.andWhere(
        new Brackets((qb) =>
          qb
            .where('point.title ILIKE :search', { search: `%${search}%` })
            .orWhere('point.address_line_1 ILIKE :search', { search: `%${search}%` })
            .orWhere('point.pin_code ILIKE :search', { search: `%${search}%` }),
        ),
      );
    }
    return query.orderBy('point.title', 'ASC').take(25).getMany();
  }

  findLoadingPoint(tenantId: string, id: string, manager?: EntityManager) {
    return (manager?.getRepository(LoadingPointEntity) ?? this.loadingPoints).findOneBy({
      id,
      tenantId,
      deletedAt: IsNull(),
    });
  }

  // --- Commodity (Product master) ---

  searchCommodities(tenantId: string, search?: string) {
    const query = this.products
      .createQueryBuilder('product')
      .where('product.tenant_id = :tenantId', { tenantId })
      .andWhere('product.deleted_at IS NULL')
      .andWhere("product.status = 'active'");
    if (search) {
      query.andWhere('product.product_details ILIKE :search', { search: `%${search}%` });
    }
    return query.orderBy('product.product_details', 'ASC').take(25).getMany();
  }

  findCommodityByExactName(tenantId: string, name: string, manager?: EntityManager) {
    return (manager?.getRepository(ProductEntity) ?? this.products)
      .createQueryBuilder('product')
      .where('product.tenant_id = :tenantId', { tenantId })
      .andWhere('product.deleted_at IS NULL')
      .andWhere('LOWER(product.product_details) = LOWER(:name)', { name })
      .getOne();
  }

  findCommodity(tenantId: string, id: string, manager?: EntityManager) {
    return (manager?.getRepository(ProductEntity) ?? this.products).findOneBy({
      id,
      tenantId,
      deletedAt: IsNull(),
    });
  }

  // --- Transporters ---

  listActiveTransporters(tenantId: string, search?: string) {
    const query = this.transporters
      .createQueryBuilder('transporter')
      .where('transporter.tenant_id = :tenantId', { tenantId })
      .andWhere('transporter.deleted_at IS NULL')
      .andWhere("transporter.status = 'active'");
    if (search) {
      query.andWhere('transporter.name ILIKE :search', { search: `%${search}%` });
    }
    return query.orderBy('transporter.name', 'ASC').take(100).getMany();
  }

  findActiveTransporters(tenantId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([] as TransporterEntity[]);
    return this.transporters.find({
      where: { tenantId, id: In(ids), status: 'active', deletedAt: IsNull() },
    });
  }

  // --- Truck types ---

  listTruckTypes(tenantId: string) {
    return this.truckTypes.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { name: 'ASC' },
    });
  }

  findTruckTypes(tenantId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([] as TruckTypeEntity[]);
    return this.truckTypes.find({ where: { tenantId, id: In(ids), deletedAt: IsNull() } });
  }

  // --- Contracts ---

  async createContract(
    data: Omit<
      CustomerContractEntity,
      'id' | 'createdAt' | 'updatedAt' | 'customer' | 'transporter'
    >,
  ) {
    return this.contracts.save(this.contracts.create(data));
  }

  findContractByNumber(tenantId: string, contractNumber: string) {
    return this.contracts.findOneBy({ tenantId, contractNumber, deletedAt: IsNull() });
  }

  findContract(tenantId: string, id: string) {
    return this.contracts.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { transporter: true },
    });
  }

  /** Every contract of the customer — callers compute lane/validity flags so non-matching ones
   *  can still be shown disabled (PL-21). */
  listContracts(tenantId: string, customerId: string) {
    return this.contracts.find({
      where: { tenantId, customerId, deletedAt: IsNull() },
      relations: { transporter: true },
      order: { validTo: 'DESC' },
    });
  }

  // --- Drafts ---

  async createDraft(tenantId: string, userId: string, payload: Record<string, unknown>) {
    return this.drafts.save(this.drafts.create({ tenantId, userId, payload }));
  }

  listDrafts(tenantId: string, userId: string) {
    return this.drafts.find({ where: { tenantId, userId }, order: { updatedAt: 'DESC' } });
  }

  findDraft(tenantId: string, userId: string, id: string) {
    return this.drafts.findOneBy({ id, tenantId, userId });
  }

  async updateDraft(draft: LoadDraftEntity, payload: Record<string, unknown>) {
    draft.payload = payload;
    return this.drafts.save(draft);
  }

  async deleteDraft(tenantId: string, userId: string, id: string): Promise<boolean> {
    const result = await this.drafts.delete({ id, tenantId, userId });
    return (result.affected ?? 0) > 0;
  }
}
