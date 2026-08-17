import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { CustomerService } from '../customers/customer.service';
import { ProductService } from '../masters/product.service';
import { LoadingPointService } from '../masters/loading-point.service';
import { toDateString } from '../../shared/utils/date';
import { paginate, Paginated } from '../masters/utils/masters.types';
import { RequisitionRepository } from './requisition.repository';
import { LoadRepository } from './load.repository';
import { RequisitionEntity } from './entities/requisition.entity';
import { LoadEntity } from './entities/load.entity';
import { CreateRequisitionInput, ListRequisitionsInput } from './utils/requisition.interface';

export class RequisitionService {
  constructor(
    private readonly repository: RequisitionRepository,
    private readonly loadRepository: LoadRepository,
    private readonly customerService: CustomerService,
    private readonly productService: ProductService,
    private readonly loadingPointService: LoadingPointService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Captures the complete customer order — every referenced master record must be
   * approved/active before Sales can create a requisition against it.
   */
  async create(
    tenantId: string,
    actorId: string,
    input: CreateRequisitionInput,
  ): Promise<RequisitionEntity> {
    try {
      if (input.expectedDeliveryDate < toDateString(new Date())) {
        throw new ValidationError('expectedDeliveryDate cannot be in the past');
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

      const product = await this.productService.get(tenantId, input.productId);
      if (product.status !== 'active') {
        throw new ConflictError(`Product ${input.productId} is not active`);
      }

      const loadingPoint = await this.loadingPointService.get(tenantId, input.loadingPointId);
      if (loadingPoint.status !== 'active') {
        throw new ConflictError(`Loading point ${input.loadingPointId} is not active`);
      }

      const requisition = await this.repository.create({
        tenantId,
        customerId: input.customerId,
        productId: input.productId,
        quantityTonnes: String(input.quantityTonnes),
        dispatchedTonnes: '0',
        loadingPointId: input.loadingPointId,
        customerDeliveryPointId: input.customerDeliveryPointId,
        expectedDeliveryDate: input.expectedDeliveryDate,
        customerPoNumber: input.customerPoNumber.trim(),
        status: 'open',
        createdBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'REQUISITION_CREATED',
        resourceType: 'requisition',
        newData: { id: requisition.id, quantityTonnes: requisition.quantityTonnes },
      });

      return requisition;
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
}
