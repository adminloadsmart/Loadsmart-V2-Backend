import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { AuditService } from '../../audit/audit.service';
import { ProductRepository, ProductWithCreator } from './product.repository';
import { MasterUsageRepository } from '../masters.usage';
import {
  CFT_PER_CBM,
  KG_PER_CBM,
  METRES_PER_DIMENSION_UNIT,
  ProductConversionModel,
  ProductDimensionUnit,
} from './product.types';
import { ProductEntity } from './entities/product.entity';
import { buildCsv, CSV_EXPORT_MAX_ROWS, CsvColumn } from '../../../shared/utils/csv';
import { CreateProductInput, ListProductsInput, UpdateProductInput } from './product.interface';
import { MasterApprovalNotifier } from '../../notifications/notifications.interface';
import { paginate } from '../../../shared/utils/pagination';

const MOVED_WINDOW_MONTHS = 6;

/**
 * "Total calculated volume" and "Volumetric weight" for the Add a Product drawer — L × W × H in the
 * chosen scale unit, converted to m³, times the conversion model's kg/m³ (surface 250, air 167).
 * Null unless all three dimensions are known. 12 × 2.4 × 2.5 m, surface → 72 m³ → 18,000 kg.
 */
export function computeVolumetrics(dimensions: {
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  dimensionUnit?: ProductDimensionUnit | null;
  conversionModel?: ProductConversionModel | null;
}): { volumeCbm: string | null; volumetricWeightKg: string | null } {
  const { length, width, height } = dimensions;
  if (length == null || width == null || height == null)
    return { volumeCbm: null, volumetricWeightKg: null };
  const metres = METRES_PER_DIMENSION_UNIT[dimensions.dimensionUnit ?? 'm'];
  const volume = Number(length) * Number(width) * Number(height) * metres ** 3;
  const kgPerCbm = KG_PER_CBM[dimensions.conversionModel ?? 'surface_road'];
  return { volumeCbm: volume.toFixed(3), volumetricWeightKg: (volume * kgPerCbm).toFixed(2) };
}

/** A product as Settings → Products reads it: every column plus the creator's name, the cubic-feet
 *  volume and "Moved (6 mo)" tonnes. */
export function toProductView(product: ProductWithCreator, movedTonnes?: string) {
  const { createdByUser, ...rest } = product;
  return {
    ...rest,
    createdByUser: createdByUser
      ? { id: createdByUser.id, fullName: createdByUser.fullName }
      : null,
    volumeCft:
      product.volumeCbm == null ? null : (Number(product.volumeCbm) * CFT_PER_CBM).toFixed(2),
    movedLast6MonthsTonnes: movedTonnes ?? '0.00',
  };
}

const PRODUCT_EXPORT_COLUMNS: CsvColumn<ReturnType<typeof toProductView>>[] = [
  { header: 'productDetails', value: (p) => p.productDetails },
  { header: 'hsnCode', value: (p) => p.hsnCode },
  { header: 'billingUnit', value: (p) => p.billingUnit },
  { header: 'packaging', value: (p) => p.packaging },
  { header: 'classification', value: (p) => p.classification },
  { header: 'length', value: (p) => p.length },
  { header: 'width', value: (p) => p.width },
  { header: 'height', value: (p) => p.height },
  { header: 'dimensionUnit', value: (p) => p.dimensionUnit },
  { header: 'conversionModel', value: (p) => p.conversionModel },
  { header: 'volumeCbm', value: (p) => p.volumeCbm },
  { header: 'volumetricWeightKg', value: (p) => p.volumetricWeightKg },
  { header: 'invoiceValue', value: (p) => p.invoiceValue },
  { header: 'standardRate', value: (p) => p.standardRate },
  {
    header: 'subItems',
    value: (p) => (p.subItems ?? []).map((item) => item.name).join(' | '),
  },
  { header: 'movedLast6MonthsTonnes', value: (p) => p.movedLast6MonthsTonnes },
  { header: 'status', value: (p) => p.status },
];

const sixMonthsAgo = () => {
  const since = new Date();
  since.setMonth(since.getMonth() - MOVED_WINDOW_MONTHS);
  return since;
};

const numericOrNull = (value: number | null | undefined) => (value == null ? null : String(value));

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly auditService: AuditService,
    private readonly usage: MasterUsageRepository,
    // LS_N_0009/0010 — optional; only queues a notification after the existing logic and never
    // throws (see notifications/master-approvals.ts).
    private readonly approvalNotifier?: MasterApprovalNotifier,
  ) {}
  async create(tenantId: string, actorId: string, role: string, input: CreateProductInput) {
    try {
      const autoApproved = role === ORG_ADMIN_ROLE;
      const now = autoApproved ? new Date() : null;
      const product = await this.repository.create(
        {
          tenantId,
          productDetails: input.productDetails.trim(),
          hsnCode: input.hsnCode?.trim() ?? null,
          packaging: input.packaging ?? null,
          invoiceValue: input.invoiceValue == null ? null : String(input.invoiceValue),
          standardRate: input.standardRate == null ? null : String(input.standardRate),
          billingUnit: input.billingUnit?.trim() ?? null,
          dimensions: input.dimensions?.trim() ?? null,
          weight: input.weight == null ? null : String(input.weight),
          weightUnit: input.weightUnit?.trim() ?? null,
          classification: input.classification ?? 'non_hazardous',
          length: numericOrNull(input.length),
          width: numericOrNull(input.width),
          height: numericOrNull(input.height),
          dimensionUnit: input.dimensionUnit ?? (input.length != null ? 'm' : null),
          conversionModel: input.conversionModel ?? (input.length != null ? 'surface_road' : null),
          ...computeVolumetrics(input),
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
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PRODUCT_CREATED',
        resourceType: 'product',
        newData: {
          id: product.id,
          productDetails: product.productDetails,
          approvalStatus: product.approvalStatus,
          status: product.status,
          subItemCount: product.subItems?.length ?? input.subItems?.length ?? 0,
        },
      });
      await this.approvalNotifier?.requested({
        kind: 'product',
        tenantId,
        recordId: product.id,
        masterValue: product.productDetails,
        createdBy: product.createdBy,
        pending: product.approvalStatus === 'pending_approval',
      });
      return product;
    } catch (error) {
      rethrow(error, 'Failed to create product');
    }
  }
  async list(tenantId: string, input: ListProductsInput) {
    try {
      const [items, total] = await this.repository.list(tenantId, input);
      const moved = await this.repository.movedTonnesSince(
        tenantId,
        items.map((item) => item.id),
        sixMonthsAgo(),
      );
      return paginate(
        items.map((item) => toProductView(item, moved.get(item.id))),
        total,
        input,
      );
    } catch (error) {
      rethrow(error, 'Failed to list products');
    }
  }
  async export(
    tenantId: string,
    filters: Omit<ListProductsInput, 'page' | 'limit'>,
  ): Promise<string> {
    try {
      const [items] = await this.repository.list(tenantId, {
        ...filters,
        page: 1,
        limit: CSV_EXPORT_MAX_ROWS,
      });
      const moved = await this.repository.movedTonnesSince(
        tenantId,
        items.map((item) => item.id),
        sixMonthsAgo(),
      );
      return buildCsv(
        PRODUCT_EXPORT_COLUMNS,
        items.map((item) => toProductView(item, moved.get(item.id))),
      );
    } catch (error) {
      rethrow(error, 'Failed to export products');
    }
  }
  async get(tenantId: string, id: string) {
    try {
      const product = await this.repository.findById(tenantId, id);
      if (!product) throw new NotFoundError(`Product ${id} not found`);
      product.subItems = product.subItems.filter((item) => !item.deletedAt);
      const moved = await this.repository.movedTonnesSince(tenantId, [id], sixMonthsAgo());
      return toProductView(product, moved.get(id));
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
      for (const key of [
        'productDetails',
        'hsnCode',
        'packaging',
        'billingUnit',
        'dimensions',
        'weightUnit',
      ])
        if (typeof data[key] === 'string') data[key] = data[key].trim();
      if ('invoiceValue' in data)
        data.invoiceValue = data.invoiceValue == null ? null : String(data.invoiceValue);
      if ('standardRate' in data)
        data.standardRate = data.standardRate == null ? null : String(data.standardRate);
      if ('weight' in data) data.weight = data.weight == null ? null : String(data.weight);
      const dimensionKeys = ['length', 'width', 'height', 'dimensionUnit', 'conversionModel'];
      if (dimensionKeys.some((key) => key in data)) {
        for (const key of ['length', 'width', 'height'])
          if (key in data) data[key] = data[key] == null ? null : String(data[key]);
        const merged = { ...existing, ...data } as ProductEntity;
        if (merged.length != null && !merged.dimensionUnit) data.dimensionUnit = 'm';
        if (merged.length != null && !merged.conversionModel) data.conversionModel = 'surface_road';
        Object.assign(data, computeVolumetrics({ ...merged, ...data } as ProductEntity));
      }
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
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PRODUCT_UPDATED',
        resourceType: 'product',
        oldData: { id, productDetails: existing.productDetails, status: existing.status },
        newData: { id, fields: Object.keys(fields), subItems: Object.keys(subItems ?? {}) },
      });
      return result;
    } catch (error) {
      rethrow(error, 'Failed to update product');
    }
  }
  async approve(tenantId: string, actorId: string, id: string) {
    const value = await this.transition(tenantId, actorId, id, {
      approvalStatus: 'approved',
      status: 'active',
      approvedBy: actorId,
      approvedAt: new Date(),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    });
    await this.approvalNotifier?.approved({
      kind: 'product',
      tenantId,
      recordId: value.id,
      masterValue: value.productDetails,
      createdBy: value.createdBy,
      approvedBy: actorId,
    });
    return value;
  }
  async reject(tenantId: string, actorId: string, id: string, reason: string) {
    const value = await this.transition(tenantId, actorId, id, {
      approvalStatus: 'rejected',
      status: 'inactive',
      rejectedBy: actorId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    });
    await this.approvalNotifier?.rejected({
      kind: 'product',
      tenantId,
      recordId: value.id,
      masterValue: value.productDetails,
      createdBy: value.createdBy,
      rejectedBy: actorId,
      reason,
    });
    return value;
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
  /** Delete guard — blocked while a load carrying this product is still running. Once every such
   *  load is closed it is soft-deleted, so past loads keep showing it but new ones cannot pick it. */
  private async assertNotInUse(tenantId: string, id: string) {
    const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'product', id });
    if (activeLoads.length)
      throw new ConflictError(
        `Product is in use right now — ${activeLoads[0].code} is still running, so it cannot be deleted`,
        { activeLoads },
      );
  }
  async delete(tenantId: string, actorId: string, id: string) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      await this.assertNotInUse(tenantId, id);
      await this.repository.softDelete(tenantId, id, actorId);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PRODUCT_DELETED',
        resourceType: 'product',
        oldData: { id, status: existing.status, approvalStatus: existing.approvalStatus },
        newData: { id, deleted: true, status: 'inactive' },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete product');
    }
  }
  async setStatus(tenantId: string, actorId: string, id: string, status: 'active' | 'inactive') {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Product ${id} not found`);
      if (status === 'active' && existing.approvalStatus !== 'approved')
        throw new ConflictError('Only approved products can be activated');
      const value = await this.repository.update(tenantId, id, { status }, {}, id);
      if (!value) throw new NotFoundError(`Product ${id} not found`);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'PRODUCT_STATUS_UPDATED',
        resourceType: 'product',
        oldData: { id, status: existing.status },
        newData: { id, status },
      });
      return value;
    } catch (error) {
      rethrow(error, 'Failed to update product status');
    }
  }
}
