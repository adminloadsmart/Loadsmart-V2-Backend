import { DataSource, EntityManager, ILike, In, IsNull, Not, Repository } from 'typeorm';
import { DriverTenantRelationEntity } from '../../driver/entities/driver-tenant-relation.entity';
import { MaintenanceJobEntity } from '../../maintenance/entities/maintenance-job.entity';
import { LoadEntity } from '../entities/load.entity';
import { RequisitionEntity } from '../entities/requisition.entity';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadingPointEntity } from '../../masters/loading-point/entities/loading-point.entity';
import { ProductEntity } from '../../masters/product/entities/product.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { TruckTypeEntity } from '../../masters/truck-type/entities/truck-type.entity';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { LoadPostingEntity } from './entities/load-posting.entity';
import { LoadRecipientEntity } from './entities/load-recipient.entity';
import { LoadDraftEntity } from './entities/load-draft.entity';
import { CustomerContractEntity } from './entities/customer-contract.entity';
import { MessageStatus, RecipientType } from './utils/load-posting.types';

/** ILIKE pattern with the user's own `%`, `_` and `\\` escaped so they match literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const contains = (value: string) => ILike(`%${escapeLike(value)}%`);
/** Case-insensitive equality — ILIKE without wildcards. */
const equalsIgnoreCase = (value: string) => ILike(escapeLike(value));

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
  private readonly requisitions: Repository<RequisitionEntity>;
  private readonly loads: Repository<LoadEntity>;
  private readonly maintenanceJobs: Repository<MaintenanceJobEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;
  private readonly drafts: Repository<LoadDraftEntity>;
  private readonly contracts: Repository<CustomerContractEntity>;
  private readonly customers: Repository<CustomerEntity>;
  private readonly deliveryPoints: Repository<CustomerDeliveryPointEntity>;
  private readonly loadingPoints: Repository<LoadingPointEntity>;
  private readonly products: Repository<ProductEntity>;
  private readonly transporters: Repository<TransporterEntity>;
  private readonly truckTypes: Repository<TruckTypeEntity>;
  private readonly vehicles: Repository<VehicleEntity>;

  constructor(dataSource: DataSource) {
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.recipients = dataSource.getRepository(LoadRecipientEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.loads = dataSource.getRepository(LoadEntity);
    this.maintenanceJobs = dataSource.getRepository(MaintenanceJobEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
    this.drafts = dataSource.getRepository(LoadDraftEntity);
    this.contracts = dataSource.getRepository(CustomerContractEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.deliveryPoints = dataSource.getRepository(CustomerDeliveryPointEntity);
    this.loadingPoints = dataSource.getRepository(LoadingPointEntity);
    this.products = dataSource.getRepository(ProductEntity);
    this.transporters = dataSource.getRepository(TransporterEntity);
    this.truckTypes = dataSource.getRepository(TruckTypeEntity);
    this.vehicles = dataSource.getRepository(VehicleEntity);
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

  /** Every time a load was raised for a customer, newest first — from Post a load and from the
   *  older requisition flow, so existing customers show up before their first posting. One row
   *  per posting/requisition; callers keep the first row of each customer. */
  async listCustomerActivity(
    tenantId: string,
    take: number,
  ): Promise<{ customerId: string; at: Date }[]> {
    const [postings, requisitions] = await Promise.all([
      this.postings.find({
        select: { customerId: true, createdAt: true },
        where: { tenantId, customerId: Not(IsNull()) },
        order: { createdAt: 'DESC' },
        take,
      }),
      this.requisitions.find({
        select: { customerId: true, createdAt: true },
        where: { tenantId },
        order: { createdAt: 'DESC' },
        take,
      }),
    ]);
    return [...postings, ...requisitions]
      .map((row) => ({ customerId: row.customerId as string, at: row.createdAt }))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /** The loads a posting spawned, one per truck. */
  listLoadsByPosting(tenantId: string, postingId: string) {
    return this.loads.find({ where: { tenantId, postingId }, order: { code: 'ASC' } });
  }

  // --- Workshop ---

  /** Trucks with an open maintenance visit (a service or breakdown) — the maintenance module's
   *  own definition of "in the workshop", which also flips the vehicle to under_maintenance. */
  async listVehicleIdsInWorkshop(tenantId: string, vehicleIds: string[]): Promise<Set<string>> {
    if (!vehicleIds.length) return new Set();
    const jobs = await this.maintenanceJobs.find({
      select: { vehicleId: true },
      where: { tenantId, vehicleId: In(vehicleIds), status: 'open' },
    });
    return new Set(jobs.map((job) => job.vehicleId));
  }

  // --- Drivers ---

  /** This tenant's active drivers with their operational status row, optionally filtered by name. */
  listActiveDriverRelations(tenantId: string, search?: string) {
    return this.driverRelations.find({
      where: {
        tenantId,
        status: 'active',
        driver: search
          ? { deletedAt: IsNull(), fullName: contains(search) }
          : { deletedAt: IsNull() },
      },
      relations: { driver: true, operationalStatus: true },
      order: { driver: { fullName: 'ASC' } },
      take: 100,
    });
  }

  /** Relations for specific global driver ids (a vehicle's linked drivers, a picked driver). */
  listDriverRelationsByDriverIds(tenantId: string, driverIds: string[]) {
    if (!driverIds.length) return Promise.resolve([] as DriverTenantRelationEntity[]);
    return this.driverRelations.find({
      where: { tenantId, driverId: In(driverIds) },
      relations: { driver: true, operationalStatus: true },
    });
  }

  /** Which of these drivers are on a live load right now. */
  async listDriverIdsOnActiveLoads(tenantId: string, driverIds: string[]): Promise<Set<string>> {
    if (!driverIds.length) return new Set();
    const rows = await this.loads.find({
      select: { driverId: true },
      where: {
        tenantId,
        driverId: In(driverIds),
        status: In([
          'assigned',
          'loading_confirmed',
          'at_plant',
          'in_transit',
          'reached_delivery_point',
        ]),
      },
    });
    return new Set(rows.map((row) => row.driverId as string));
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
   *  (PL-02). Rejected customers never show; each row carries its live unloading-point count. */
  async searchCustomers(tenantId: string, search: string | undefined, limit: number) {
    const base = { tenantId, deletedAt: IsNull(), status: In(['active', 'pending'] as const) };
    const customers = await this.customers.find({
      where: search
        ? [
            { ...base, name: contains(search) },
            { ...base, code: contains(search) },
          ]
        : base,
      order: { name: 'ASC' },
      take: limit,
    });
    const points = customers.length
      ? await this.deliveryPoints.find({
          select: { customerId: true },
          where: { tenantId, customerId: In(customers.map((c) => c.id)), deletedAt: IsNull() },
        })
      : [];
    return customers.map((customer) => ({
      customer,
      unloadingPointCount: points.filter((point) => point.customerId === customer.id).length,
    }));
  }

  findCustomerByExactName(tenantId: string, name: string) {
    return this.customers.findOne({
      where: { tenantId, deletedAt: IsNull(), name: equalsIgnoreCase(name) },
    });
  }

  // --- Addresses ---

  listUnloadingPoints(tenantId: string, customerId: string, search?: string) {
    const base = { tenantId, customerId, deletedAt: IsNull() };
    return this.deliveryPoints.find({
      where: search
        ? [
            { ...base, location: contains(search) },
            { ...base, addressLine1: contains(search) },
            { ...base, pinCode: contains(search) },
          ]
        : base,
      order: { location: 'ASC' },
      take: 25,
    });
  }

  findUnloadingPoint(tenantId: string, customerId: string, id: string) {
    return this.deliveryPoints.findOneBy({ id, tenantId, customerId, deletedAt: IsNull() });
  }

  /** Loading point master — name, address or pincode (PL-09). Active and pending both show, a new
   *  pickup the shipper just added is pending until an org admin approves it. */
  searchLoadingPoints(tenantId: string, search?: string) {
    const base = { tenantId, deletedAt: IsNull(), status: In(['active', 'pending'] as const) };
    return this.loadingPoints.find({
      where: search
        ? [
            { ...base, title: contains(search) },
            { ...base, addressLine1: contains(search) },
            { ...base, pinCode: contains(search) },
          ]
        : base,
      order: { title: 'ASC' },
      take: 25,
    });
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
    const base = { tenantId, deletedAt: IsNull(), status: 'active' as const };
    return this.products.find({
      where: search ? { ...base, productDetails: contains(search) } : base,
      order: { productDetails: 'ASC' },
      take: 25,
    });
  }

  findCommodityByExactName(tenantId: string, name: string, manager?: EntityManager) {
    return (manager?.getRepository(ProductEntity) ?? this.products).findOne({
      where: { tenantId, deletedAt: IsNull(), productDetails: equalsIgnoreCase(name) },
    });
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
    const base = { tenantId, deletedAt: IsNull(), status: 'active' as const };
    return this.transporters.find({
      where: search ? { ...base, name: contains(search) } : base,
      order: { name: 'ASC' },
      take: 100,
    });
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
