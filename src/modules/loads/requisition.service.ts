import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { CustomerService } from '../customers/customer.service';
import { ProductService } from '../masters/product.service';
import { ProductEntity } from '../masters/entities/product.entity';
import { LoadingPointService } from '../masters/loading-point.service';
import { toDateString } from '../../shared/utils/date';
import { paginate, Paginated } from '../masters/utils/masters.types';
import { RequisitionRepository } from './requisition.repository';
import { LoadRepository } from './load.repository';
import { CodeSequenceRepository } from './code-sequence.repository';
import { RequisitionEntity } from './entities/requisition.entity';
import { LoadEntity } from './entities/load.entity';
import {
  CreateRequisitionInput,
  ListRequisitionsInput,
  RequisitionProductLineInput,
} from './utils/requisition.interface';
import { RequisitionItemUnit } from './utils/loads.types';
import { formatRequisitionCode } from './utils/code.util';

interface ResolvedRequisitionLine {
  productId: string;
  quantityTonnes: number;
  quantity: number | null;
  unit: RequisitionItemUnit | null;
}

const MIN_OVERRIDE_REASON_LENGTH = 15; // V-17

/**
 * Tonnage is the mandatory figure the module runs on; if given directly it always wins ("typing
 * directly overrides it" — Plan Dispatch v2.0 §4.1). Otherwise derives it from the convenience
 * quantity+unit using the product's weight per pack — 'tonnes' copies quantity straight across;
 * any other unit is treated as one pack, weighing `product.weight` in `product.weightUnit`
 * (kilograms unless the master says otherwise).
 */
function resolveLineTonnage(product: ProductEntity, line: RequisitionProductLineInput): number {
  if (line.quantityTonnes !== undefined) return line.quantityTonnes;

  if (line.unit === 'tonnes') return line.quantity!;

  if (!product.weight) {
    throw new ValidationError(
      `Product ${product.id} has no weight set in the master — enter tonnage directly for this line`,
    );
  }
  const perUnitTonnes = (product.weightUnit ?? 'kg').trim().toLowerCase().startsWith('ton')
    ? Number(product.weight)
    : Number(product.weight) / 1000;
  return line.quantity! * perUnitTonnes;
}

export class RequisitionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: RequisitionRepository,
    private readonly loadRepository: LoadRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly customerService: CustomerService,
    private readonly productService: ProductService,
    private readonly loadingPointService: LoadingPointService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Captures the complete customer order — every referenced master record must be
   * approved/active before Sales can create a requisition against it. A requisition can hold
   * multiple products (Plan Dispatch v2.0 R-02), each its own RequisitionItemEntity row.
   */
  async create(
    tenantId: string,
    actorId: string,
    input: CreateRequisitionInput,
  ): Promise<RequisitionEntity> {
    try {
      if (!input.products?.length) {
        throw new ValidationError('At least one product line is required'); // V-02
      }
      if (input.pickupDate < toDateString(new Date())) {
        throw new ValidationError('pickupDate cannot be in the past');
      }
      if (input.expectedDeliveryDate < toDateString(new Date())) {
        throw new ValidationError('expectedDeliveryDate cannot be in the past'); // V-09
      }
      if (input.pickupDate > input.expectedDeliveryDate) {
        throw new ValidationError('pickupDate cannot be after expectedDeliveryDate');
      }

      const customer = await this.customerService.assertActive(tenantId, input.customerId);
      const deliveryPoint = customer.deliveryPoints?.find(
        (point) => point.id === input.customerDeliveryPointId && !point.deletedAt,
      );
      if (!deliveryPoint) {
        throw new ValidationError(
          `Delivery point ${input.customerDeliveryPointId} does not belong to customer ${input.customerId}`,
        );
      }

      // Every product line active — FMS-LOAD-012 "only approved, active master records can be
      // selected" applies per line, not just once. Resolve each line's tonnage here too, while
      // the product (and its weight-per-pack) is already in hand.
      const resolvedLines: ResolvedRequisitionLine[] = [];
      for (const line of input.products) {
        const product = await this.productService.get(tenantId, line.productId);
        if (product.status !== 'active') {
          throw new ConflictError(`Product ${line.productId} is not active`);
        }
        resolvedLines.push({
          productId: line.productId,
          quantityTonnes: resolveLineTonnage(product, line),
          quantity: line.quantity ?? null,
          unit: line.unit ?? null,
        });
      }

      const loadingPoint = await this.loadingPointService.get(tenantId, input.loadingPointId);
      if (loadingPoint.status !== 'active') {
        throw new ConflictError(`Loading point ${input.loadingPointId} is not active`);
      }

      // C-05 — amber, overridable: the PO/SO number already in use on another requisition.
      const customerPoNumber = input.customerPoNumber.trim();
      const clash = await this.repository.findByPoNumber(tenantId, customerPoNumber);
      const c05Override = input.overrides?.find((override) => override.checkId === 'C05');
      if (clash) {
        if (!c05Override) {
          throw new ConflictError(
            `PO/SO number "${customerPoNumber}" is already used on requisition ${clash.id} — override with a reason to proceed`,
          );
        }
        if (c05Override.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH) {
          throw new ValidationError(
            `Override reason must be at least ${MIN_OVERRIDE_REASON_LENGTH} characters`, // V-17
          );
        }
      }

      const quantityTonnes = resolvedLines
        .reduce((sum, line) => sum + line.quantityTonnes, 0)
        .toFixed(2);

      const requisition = await this.dataSource.transaction(async (manager) => {
        const sequenceValue = await this.codeSequenceRepository.next(
          'requisition',
          tenantId,
          manager,
        );
        const code = formatRequisitionCode(sequenceValue);

        const created = await this.repository.create(
          {
            tenantId,
            code,
            customerId: input.customerId,
            quantityTonnes,
            dispatchedTonnes: '0',
            loadingPointId: input.loadingPointId,
            customerDeliveryPointId: input.customerDeliveryPointId,
            pickupDate: input.pickupDate,
            expectedDeliveryDate: input.expectedDeliveryDate,
            customerPoNumber,
            status: 'open',
            createdBy: actorId,
          },
          manager,
        );

        await this.repository.createItems(
          resolvedLines.map((line) => ({
            tenantId,
            requisitionId: created.id,
            productId: line.productId,
            quantityTonnes: line.quantityTonnes.toFixed(2),
            quantity: line.quantity === null ? null : String(line.quantity),
            unit: line.unit,
          })),
          manager,
        );

        return created;
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'REQUISITION_CREATED',
        resourceType: 'requisition',
        newData: {
          id: requisition.id,
          code: requisition.code,
          quantityTonnes: requisition.quantityTonnes,
          productLines: resolvedLines.length,
          ...(c05Override ? { c05Override: { reason: c05Override.reason, by: actorId } } : {}),
        },
      });

      return (await this.repository.findById(tenantId, requisition.id)) ?? requisition;
    } catch (error) {
      rethrow(error, 'Failed to create requisition');
    }
  }

  async list(
    tenantId: string,
    input: ListRequisitionsInput,
  ): Promise<Paginated<RequisitionEntity>> {
    try {
      const [items, total] = await this.repository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list requisitions');
    }
  }

  /** Dispatched-vs-remaining tonnage plus every child load's current status. */
  async get(
    tenantId: string,
    id: string,
  ): Promise<{ requisition: RequisitionEntity; loads: LoadEntity[] }> {
    try {
      const requisition = await this.repository.findById(tenantId, id);
      if (!requisition) throw new NotFoundError(`Requisition ${id} not found`);
      const loads = await this.loadRepository.findByRequisitionId(tenantId, id);
      return { requisition, loads };
    } catch (error) {
      rethrow(error, 'Failed to fetch requisition');
    }
  }

  async assertOpen(tenantId: string, id: string): Promise<RequisitionEntity> {
    try {
      const requisition = await this.repository.findById(tenantId, id);
      if (!requisition) throw new NotFoundError(`Requisition ${id} not found`);
      if (requisition.status === 'closed') {
        throw new ConflictError(`Requisition ${id} is closed`);
      }
      return requisition;
    } catch (error) {
      rethrow(error, 'Failed to verify requisition is open');
    }
  }

  /** Manual close with a reason (e.g. customer cancelled the remaining quantity). */
  async close(
    tenantId: string,
    actorId: string,
    id: string,
    reason: string,
  ): Promise<RequisitionEntity> {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Requisition ${id} not found`);
      if (existing.status === 'closed') throw new ConflictError('Requisition is already closed');

      const closed = await this.repository.close(tenantId, id, {
        closedReason: reason,
        closedBy: actorId,
      });
      if (!closed) throw new ConflictError('Requisition close failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'REQUISITION_CLOSED',
        resourceType: 'requisition',
        oldData: { id, status: existing.status },
        newData: { id, status: 'closed', closedReason: reason },
      });

      return closed;
    } catch (error) {
      rethrow(error, 'Failed to close requisition');
    }
  }

  /** Hard delete — undoes a mistaken create. Only allowed while zero loads exist against the
   *  requisition; once one does, `close` is the only removal-adjacent action (Dispatch Planning
   *  has already committed capacity/tonnage against it). */
  async delete(tenantId: string, actorId: string, id: string): Promise<void> {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Requisition ${id} not found`);

      const loads = await this.loadRepository.findByRequisitionId(tenantId, id);
      if (loads.length > 0) {
        throw new ConflictError(
          `Cannot delete requisition ${id} — ${loads.length} load(s) already exist against it; close it instead`,
        );
      }

      await this.repository.delete(tenantId, id);

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'REQUISITION_DELETED',
        resourceType: 'requisition',
        oldData: {
          id,
          code: existing.code,
          status: existing.status,
          quantityTonnes: existing.quantityTonnes,
          customerPoNumber: existing.customerPoNumber,
        },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete requisition');
    }
  }
}
