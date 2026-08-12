import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { CustomerEntity } from './entities/customer.entity';
import { CustomerDeliveryPointEntity } from './entities/customer-delivery-point.entity';
import { CreateCustomerInput, ListCustomersInput, UpdateCustomerInput } from './customer.types';

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
  ) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    const customer = repo.create({
      tenantId,
      createdBy: actorId,
      status,
      name: input.name,
      mobile: input.mobile,
      email: input.email ?? null,
      gstin: input.gstin ?? null,
      advancePercentage: input.advancePercentage?.toString() ?? null,
      creditDays: input.creditDays ?? null,
      rateContract: input.rateContract ?? null,
      deletedAt: null,
      approvedBy: status === 'active' ? actorId : null,
      approvedAt: status === 'active' ? new Date() : null,
    });
    return repo.save(customer);
  }
  async addPoints(
    customerId: string,
    tenantId: string,
    points: { location: string }[],
    manager?: EntityManager,
  ) {
    const repo = manager?.getRepository(CustomerDeliveryPointEntity) ?? this.points;
    if (!points.length) return [];
    return repo.save(
      points.map((point) =>
        repo.create({ customerId, tenantId, location: point.location, deletedAt: null }),
      ),
    );
  }
  findById(tenantId: string, id: string, manager?: EntityManager) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    return repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { deliveryPoints: true },
    });
  }
  async list(tenantId: string, filters: ListCustomersInput) {
    const { page, limit, search, status } = filters;
    const query = this.customers
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.deliveryPoints', 'point', 'point.deleted_at IS NULL')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.deleted_at IS NULL');
    if (status) query.andWhere('customer.status = :status', { status });
    if (search)
      query.andWhere(
        '(customer.name ILIKE :search OR customer.mobile ILIKE :search OR customer.email ILIKE :search OR customer.gstin ILIKE :search)',
        { search: `%${search}%` },
      );
    const [items, total] = await query
      .orderBy('customer.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items, total };
  }
  async update(
    tenantId: string,
    id: string,
    actorId: string,
    input: UpdateCustomerInput,
    manager?: EntityManager,
  ) {
    const repo = manager?.getRepository(CustomerEntity) ?? this.customers;
    const { deliveryPoints: _deliveryPoints, ...customerInput } = input;
    const data = {
      ...customerInput,
      advancePercentage:
        input.advancePercentage === undefined || input.advancePercentage === null
          ? input.advancePercentage
          : input.advancePercentage.toString(),
      updatedBy: actorId,
    };
    await repo.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id, manager);
  }
  async replacePoints(
    tenantId: string,
    customerId: string,
    values: { location: string }[],
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(CustomerDeliveryPointEntity);
    await repo.update({ tenantId, customerId, deletedAt: IsNull() }, { deletedAt: new Date() });
    return this.addPoints(customerId, tenantId, values, manager);
  }
  async approve(tenantId: string, id: string, actorId: string) {
    const result = await this.customers.update(
      { id, tenantId, status: 'pending', deletedAt: IsNull() },
      { status: 'active', approvedBy: actorId, approvedAt: new Date(), updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }
}
