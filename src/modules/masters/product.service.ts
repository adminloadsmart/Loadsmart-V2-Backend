import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { ProductRepository } from './product.repository';
import {
  CreateProductInput,
  ListProductsInput,
  UpdateProductInput,
} from './utils/product.interface';
import { paginate } from './utils/masters.types';

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly auditService: AuditService,
  ) {}
  async create(tenantId: string, actorId: string, role: string, input: CreateProductInput) {
    try {
      const autoApproved = role === ORG_ADMIN_ROLE;
      const now = autoApproved ? new Date() : null;
      return await this.repository.create(
        {
          tenantId,
          productDetails: input.productDetails.trim(),
          hsnCode: input.hsnCode?.trim() ?? null,
          invoiceValue: input.invoiceValue == null ? null : String(input.invoiceValue),
          billingUnit: input.billingUnit?.trim() ?? null,
          dimensions: input.dimensions?.trim() ?? null,
          weight: input.weight == null ? null : String(input.weight),
          weightUnit: input.weightUnit?.trim() ?? null,
          approvalStatus: autoApproved ? 'approved' : 'pending_approval',
          status: autoApproved ? 'active' : 'inactive',
          createdBy: actorId,
          approvedBy: autoApproved ? actorId : null,
          approvedAt: now,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
        },
        input.subItems?.map((item) => item.name.trim()) ?? [],
        actorId,
      );
    } catch (error) {
      rethrow(error, 'Failed to create product');
    }
  }
  async list(tenantId: string, input: ListProductsInput) {
    try {
      const result = await this.repository.list(tenantId, input);
      return paginate(result[0], result[1], input);
    } catch (error) {
      rethrow(error, 'Failed to list products');
    }
  }
  async get(tenantId: string, id: string) {
    try {
      const product = await this.repository.findById(tenantId, id);
      if (!product) throw new NotFoundError(`Product ${id} not found`);
      product.subItems = product.subItems.filter((item) => !item.deletedAt);
      return product;
    } catch (error) {
      rethrow(error, 'Failed to fetch product');
    }
  }
  async update(tenantId: string, actorId: string, id: string, input: UpdateProductInput) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      if (input.status === 'active' && existing.approvalStatus !== 'approved')
        throw new ConflictError('Only approved products can be activated');
      const { subItems, ...fields } = input;
      const data = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      for (const key of ['productDetails', 'hsnCode', 'billingUnit', 'dimensions', 'weightUnit'])
        if (typeof data[key] === 'string') data[key] = data[key].trim();
      if ('invoiceValue' in data)
        data.invoiceValue = data.invoiceValue == null ? null : String(data.invoiceValue);
      if ('weight' in data) data.weight = data.weight == null ? null : String(data.weight);
      const result = await this.repository.update(
        tenantId,
        id,
        data,
        {
          add: subItems?.add?.map((item) => item.name.trim()),
          update: subItems?.update?.map((item) => ({ ...item, name: item.name.trim() })),
          remove: subItems?.remove,
        },
        actorId,
      );
      if (!result) throw new NotFoundError(`Product ${id} not found`);
      return result;
    } catch (error) {
      rethrow(error, 'Failed to update product');
    }
  }
  async approve(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, {
      approvalStatus: 'approved',
      status: 'active',
      approvedBy: actorId,
      approvedAt: new Date(),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    });
  }
  async reject(tenantId: string, actorId: string, id: string, reason: string) {
    return this.transition(tenantId, actorId, id, {
      approvalStatus: 'rejected',
      status: 'inactive',
      rejectedBy: actorId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    });
  }
  private async transition(
    tenantId: string,
    actorId: string,
    id: string,
    data: Record<string, unknown>,
  ) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      if (existing.approvalStatus !== 'pending_approval')
        throw new ConflictError('Only pending products can be transitioned');
      const value = await this.repository.transition(tenantId, id, data);
      if (!value) throw new ConflictError('Product transition failed');
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: `PRODUCT_${data.approvalStatus === 'approved' ? 'APPROVED' : 'REJECTED'}`,
        resourceType: 'product',
        oldData: { id, approvalStatus: 'pending_approval' },
        newData: { id, ...data },
      });
      return value;
    } catch (error) {
      rethrow(error, 'Failed to transition product');
    }
  }
  async delete(tenantId: string, actorId: string, id: string) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      await this.repository.softDelete(tenantId, id, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete product');
    }
  }
  async setStatus(tenantId: string, id: string, status: 'active' | 'inactive') {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      if (status === 'active' && existing.approvalStatus !== 'approved')
        throw new ConflictError('Only approved products can be activated');
      const value = await this.repository.update(tenantId, id, { status }, {}, id);
      if (!value) throw new NotFoundError(`Product ${id} not found`);
      return value;
    } catch (error) {
      rethrow(error, 'Failed to update product status');
    }
  }
}
