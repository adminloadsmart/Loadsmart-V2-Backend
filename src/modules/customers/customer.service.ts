import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { ORG_ADMIN_ROLE, SALES_ROLE } from '../../shared/constants/roles';
import { paginate } from '../admin/utils/admin.types';
import { CustomerRepository } from './customer.repository';
import { CreateCustomerInput, ListCustomersInput, UpdateCustomerInput } from './customer.types';

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly dataSource: import('typeorm').DataSource,
    private readonly audit: AuditService,
  ) {}
  private assertRole(role: string, allowed: string[]) {
    if (!allowed.includes(role)) throw new AuthorizationError('Not authorized to manage customers');
  }
  async create(
    tenantId: string,
    actorId: string,
    role: string,
    input: CreateCustomerInput,
    source: 'manual' | 'csv_import' = 'manual',
  ) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE, SALES_ROLE]);
      const status = role === ORG_ADMIN_ROLE ? 'active' : 'pending';
      const customer = await this.dataSource.transaction(async (manager) => {
        const value = await this.repository.create(tenantId, actorId, status, input, manager);
        await this.repository.addPoints(value.id, tenantId, input.deliveryPoints ?? [], manager);
        return this.repository.findById(tenantId, value.id, manager);
      });
      if (!customer) throw new NotFoundError('Customer was not created');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_CREATED',
        resourceType: 'customer',
        newData: {
          id: customer.id,
          status: customer.status,
          name: customer.name,
          source,
        },
      });
      return customer;
    } catch (error) {
      rethrow(error, 'Failed to create customer');
    }
  }
  async list(tenantId: string, role: string, input: ListCustomersInput) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const result = await this.repository.list(tenantId, input);
      return paginate(result.items, result.total, input);
    } catch (error) {
      rethrow(error, 'Failed to list customers');
    }
  }
  async get(tenantId: string, role: string, id: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const value = await this.repository.findById(tenantId, id);
      if (!value) throw new NotFoundError(`Customer ${id} not found`);
      return value;
    } catch (error) {
      rethrow(error, 'Failed to fetch customer');
    }
  }
  async update(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    input: UpdateCustomerInput,
  ) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      const updated = await this.dataSource.transaction(async (manager) => {
        const value = await this.repository.update(tenantId, id, actorId, input, manager);
        if (!value) throw new NotFoundError(`Customer ${id} not found`);
        if (input.deliveryPoints !== undefined)
          await this.repository.replacePoints(tenantId, id, input.deliveryPoints, manager);
        return this.repository.findById(tenantId, id, manager);
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_UPDATED',
        resourceType: 'customer',
        oldData: { id, status: existing.status },
        newData: { id, fields: Object.keys(input) },
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update customer');
    }
  }
  async approve(tenantId: string, actorId: string, role: string, id: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      if (existing.status !== 'pending')
        throw new ConflictError('Only pending customers can be approved');
      const value = await this.repository.approve(tenantId, id, actorId);
      if (!value) throw new ConflictError('Customer approval failed');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_APPROVED',
        resourceType: 'customer',
        oldData: { id, status: 'pending' },
        newData: { id, status: 'active', approvedBy: actorId },
      });
      return value;
    } catch (error) {
      rethrow(error, 'Failed to approve customer');
    }
  }

  async delete(tenantId: string, actorId: string, role: string, id: string): Promise<void> {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const deleted = await this.dataSource.transaction((manager) =>
        this.repository.softDelete(tenantId, id, actorId, manager),
      );
      if (!deleted) throw new NotFoundError(`Customer ${id} not found`);

      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_DELETED',
        resourceType: 'customer',
        oldData: { id },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete customer');
    }
  }
}
