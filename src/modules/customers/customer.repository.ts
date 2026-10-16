import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { CustomerEntity } from './entities/customer.entity';
import { CustomerDeliveryPointEntity } from './entities/customer-delivery-point.entity';
import { CustomerContactEntity } from './entities/customer-contact.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { ValidationError } from '../../shared/errors';
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  resolveLocationSource,
} from '../../shared/constants/location-source';
import {
  CreateCustomerInput,
  CustomerContactInput,
  DeliveryPointInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from './customer.types';

/** A customer as the Settings screens read it: entity + the creator's name ("entered by Ritu"). */
export type CustomerWithCreator = CustomerEntity & {
  createdByUser?: Pick<UserEntity, 'id' | 'fullName'> | null;
};

const toNumeric = (value: number | null | undefined) =>
  value === undefined ? undefined : value === null ? null : value.toString();

/** Columns written from a create/update input, other than relations and GST bookkeeping. */
export type CustomerColumns = Partial<
  Omit<CustomerEntity, 'deliveryPoints' | 'contacts' | 'createdAt' | 'updatedAt'>
>;

export class CustomerRepository {
  private readonly customers: Repository<CustomerEntity>;
  private readonly points: Repository<CustomerDeliveryPointEntity>;
  constructor(dataSource: DataSource) {
    this.customers = dataSource.getRepository(CustomerEntity);
    this.points = dataSource.getRepository(CustomerDeliveryPointEntity);
  }

  async create(
    tenantId: string,
    actorId: string,
    status: CustomerEntity['status'],
    input: CreateCustomerInput,
    manager?: EntityManager,
    code: string | null = null,
    extra: CustomerColumns = {},
  ) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    const customer = repo.create({
      tenantId,
      code,
      createdBy: actorId,
      status,
      name: input.name,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
      gstin: input.gstin ?? null,
      contactPersonName: input.contactPersonName ?? null,
      contactPersonNumber: input.contactPersonNumber ?? null,
      contactPersonEmail: input.contactPersonEmail ?? null,
      contactPersonDesignation: input.contactPersonDesignation ?? null,
      contactPersonDesignationOther: input.contactPersonDesignationOther ?? null,
      advancePercentage: input.advancePercentage?.toString() ?? null,
      balancePercentage: input.balancePercentage?.toString() ?? null,
      creditDays: input.creditDays ?? null,
      rateContract: input.rateContract ?? null,
      billingAddressLine1: input.billingAddressLine1 ?? null,
      billingAddressLine2: input.billingAddressLine2 ?? null,
      billingLandmark: input.billingLandmark ?? null,
      billingAreaLocality: input.billingAreaLocality ?? null,
      billingCity: input.billingCity ?? null,
      billingState: input.billingState ?? null,
      billingPinCode: input.billingPinCode ?? null,
      registeredAddress: input.registeredAddress ?? null,
      notes: input.notes ?? null,
      invoiceAgainst: input.invoiceAgainst ?? null,
      freeHoursAtDrop: input.freeHoursAtDrop ?? null,
      balanceAmount: input.balanceAmount?.toString() ?? null,
      creditLimit: input.creditLimit?.toString() ?? null,
      deletedAt: null,
      approvedBy: status === 'active' ? actorId : null,
      approvedAt: status === 'active' ? new Date() : null,
      ...extra,
    });
    return repo.save(customer);
  }

  private pointColumns(point: DeliveryPointInput) {
    return {
      location: point.location,
      addressLine1: point.addressLine1 ?? null,
      addressLine2: point.addressLine2 ?? null,
      landmark: point.landmark ?? null,
      areaLocality: point.areaLocality ?? null,
      city: point.city ?? null,
      state: point.state ?? null,
      pinCode: point.pinCode ?? null,
      latitude: point.latitude == null ? null : String(point.latitude),
      longitude: point.longitude == null ? null : String(point.longitude),
      googlePlaceId: point.googlePlaceId ?? null,
      locationSource: resolveLocationSource(point),
      geofenceRadiusM: point.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
      pocName: point.pocName ?? null,
      pocPhone: point.pocPhone ?? null,
      pocEmail: point.pocEmail ?? null,
    };
  }

  private contactColumns(contact: CustomerContactInput, sortOrder: number) {
    return {
      fullName: contact.fullName ?? null,
      designation: contact.designation ?? null,
      phone: contact.phone ?? null,
      isWhatsapp: contact.isWhatsapp ?? false,
      email: contact.email ?? null,
      sortOrder,
    };
  }

  async addPoints(
    customerId: string,
    tenantId: string,
    points: DeliveryPointInput[],
    manager?: EntityManager,
  ) {
    const repo = manager?.getRepository(CustomerDeliveryPointEntity) ?? this.points;
    if (!points.length) return [];
    return repo.save(
      points.map((point) =>
        repo.create({ customerId, tenantId, ...this.pointColumns(point), deletedAt: null }),
      ),
    );
  }

  /**
   * Id-aware sync of a customer's unloading points: an input with `id` updates that row in place
   * (so requisitions/postings pointing at it keep a stable reference), one without inserts, and
   * live rows missing from the input are soft-deleted. Unknown ids are a 400.
   */
  async syncPoints(
    tenantId: string,
    customerId: string,
    inputs: DeliveryPointInput[],
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(CustomerDeliveryPointEntity);
    const existing = await repo.findBy({ tenantId, customerId, deletedAt: IsNull() });
    const existingIds = new Set(existing.map((row) => row.id));
    const keptIds = new Set<string>();
    for (const input of inputs) {
      if (!input.id) continue;
      if (!existingIds.has(input.id))
        throw new ValidationError(`Delivery point ${input.id} does not belong to this customer`);
      keptIds.add(input.id);
      await repo.update({ id: input.id, tenantId, customerId }, this.pointColumns(input));
    }
    const removed = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
    if (removed.length)
      await repo.update({ id: In(removed), tenantId, customerId }, { deletedAt: new Date() });
    await this.addPoints(
      customerId,
      tenantId,
      inputs.filter((input) => !input.id),
      manager,
    );
  }

  /** Same id-aware sync as syncPoints, for the contact cards. Order of the array = sort_order. */
  async syncContacts(
    tenantId: string,
    customerId: string,
    inputs: CustomerContactInput[],
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(CustomerContactEntity);
    const existing = await repo.findBy({ tenantId, customerId, deletedAt: IsNull() });
    const existingIds = new Set(existing.map((row) => row.id));
    const keptIds = new Set<string>();
    const created: CustomerContactEntity[] = [];
    for (const [index, input] of inputs.entries()) {
      if (input.id) {
        if (!existingIds.has(input.id))
          throw new ValidationError(`Contact ${input.id} does not belong to this customer`);
        keptIds.add(input.id);
        await repo.update(
          { id: input.id, tenantId, customerId },
          this.contactColumns(input, index),
        );
      } else {
        created.push(
          repo.create({
            tenantId,
            customerId,
            ...this.contactColumns(input, index),
            deletedAt: null,
          }),
        );
      }
    }
    const removed = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
    if (removed.length)
      await repo.update({ id: In(removed), tenantId, customerId }, { deletedAt: new Date() });
    if (created.length) await repo.save(created);
  }

  /** Live delivery-point ids of a customer — used to work out which ones an update removes. */
  async livePointIds(tenantId: string, customerId: string): Promise<string[]> {
    const rows = await this.points.find({
      select: { id: true },
      where: { tenantId, customerId, deletedAt: IsNull() },
    });
    return rows.map((row) => row.id);
  }

  private detailQuery(manager?: EntityManager) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    return repo
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.deliveryPoints', 'point', 'point.deleted_at IS NULL')
      .leftJoinAndSelect('customer.contacts', 'contact', 'contact.deleted_at IS NULL')
      .leftJoinAndMapOne(
        'customer.createdByUser',
        UserEntity,
        'creator',
        'creator.id = customer.created_by',
      )
      .where('customer.deleted_at IS NULL');
  }

  async findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<CustomerWithCreator | null> {
    const customer = await this.detailQuery(manager)
      .andWhere('customer.tenant_id = :tenantId AND customer.id = :id', { tenantId, id })
      .orderBy('point.created_at', 'ASC')
      .addOrderBy('contact.sort_order', 'ASC')
      .getOne();
    return customer as CustomerWithCreator | null;
  }

  findByMobile(tenantId: string, mobile: string, manager?: EntityManager) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    return repo.findOneBy({ tenantId, mobile, deletedAt: IsNull() });
  }

  findByGstin(tenantId: string, gstin: string, excludeId?: string) {
    return this.customers.findOneBy({
      tenantId,
      gstin,
      deletedAt: IsNull(),
      ...(excludeId ? { id: Not(excludeId) } : {}),
    });
  }

  private filteredQuery(tenantId: string, filters: Omit<ListCustomersInput, 'page' | 'limit'>) {
    const { search, status, gstVerificationStatus } = filters;
    const query = this.detailQuery().andWhere('customer.tenant_id = :tenantId', { tenantId });
    if (status) query.andWhere('customer.status = :status', { status });
    if (gstVerificationStatus)
      query.andWhere('customer.gst_verification_status = :gstVerificationStatus', {
        gstVerificationStatus,
      });
    // "Name, GSTIN or city" — city via EXISTS, so a match doesn't trim the joined points list.
    if (search)
      query.andWhere(
        `(customer.name ILIKE :search OR customer.code ILIKE :search OR customer.mobile ILIKE :search
          OR customer.email ILIKE :search OR customer.gstin ILIKE :search
          OR customer.registered_city ILIKE :search OR customer.place_of_supply ILIKE :search
          OR EXISTS (SELECT 1 FROM customers.customer_delivery_points sp
                     WHERE sp.customer_id = customer.id AND sp.deleted_at IS NULL
                       AND sp.city ILIKE :search))`,
        { search: `%${search}%` },
      );
    return query.orderBy('customer.created_at', 'DESC').addOrderBy('contact.sort_order', 'ASC');
  }

  async list(tenantId: string, filters: ListCustomersInput) {
    const [items, total] = await this.filteredQuery(tenantId, filters)
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();
    return { items: items as CustomerWithCreator[], total };
  }

  async listForExport(
    tenantId: string,
    filters: Omit<ListCustomersInput, 'page' | 'limit'>,
    max: number,
  ) {
    const items = await this.filteredQuery(tenantId, filters).take(max).getMany();
    return items as CustomerWithCreator[];
  }

  async update(
    tenantId: string,
    id: string,
    actorId: string,
    input: UpdateCustomerInput,
    manager?: EntityManager,
    extra: CustomerColumns = {},
  ) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    const {
      deliveryPoints: _deliveryPoints,
      contacts: _contacts,
      gstVerificationId: _gstVerificationId,
      ...customerInput
    } = input;
    const data = {
      ...customerInput,
      advancePercentage: toNumeric(input.advancePercentage),
      balancePercentage: toNumeric(input.balancePercentage),
      balanceAmount: toNumeric(input.balanceAmount),
      creditLimit: toNumeric(input.creditLimit),
      ...extra,
      updatedBy: actorId,
    };
    const defined = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    await repo.update({ id, tenantId, deletedAt: IsNull() }, defined);
    return this.findById(tenantId, id, manager);
  }

  async approve(tenantId: string, id: string, actorId: string) {
    const result = await this.customers.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      {
        status: 'active',
        approvedBy: actorId,
        approvedAt: new Date(),
        rejectionReason: null,
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }
  async reject(tenantId: string, id: string, actorId: string, reason: string) {
    const result = await this.customers.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }
  async updateStatus(tenantId: string, id: string, actorId: string, status: 'active' | 'inactive') {
    const result = await this.customers.update(
      { id, tenantId, status: status === 'active' ? 'inactive' : 'active', deletedAt: IsNull() },
      { status, updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async softDelete(
    tenantId: string,
    id: string,
    deletedBy: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const customerRepo = manager.getRepository(CustomerEntity);
    const deletedAt = new Date();
    const result = await customerRepo.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt, updatedBy: deletedBy },
    );
    if (result.affected !== 1) return false;

    await manager
      .getRepository(CustomerDeliveryPointEntity)
      .update({ tenantId, customerId: id, deletedAt: IsNull() }, { deletedAt });
    await manager
      .getRepository(CustomerContactEntity)
      .update({ tenantId, customerId: id, deletedAt: IsNull() }, { deletedAt });
    return true;
  }
}
