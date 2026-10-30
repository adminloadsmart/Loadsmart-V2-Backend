import { Brackets, DataSource, SelectQueryBuilder } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { RequisitionEntity } from '../loads/entities/requisition.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ACTIVE_LOAD_STATUSES } from '../loads/utils/loads.types';
import { buildNextAction } from '../loads/utils/trip-view';
import { computeShareAmount } from '../loads/load-payment.service';

/** Which master record a usage / load-history lookup is about. A load reaches a customer or a
 *  loading point either through its requisition (dispatch flow) or its posting (Post a load). */
export type MasterUsageTarget =
  | { kind: 'customer'; id: string }
  | { kind: 'transporter'; id: string }
  | { kind: 'loading_point'; id: string }
  | { kind: 'product'; id: string }
  | { kind: 'delivery_points'; ids: string[] };

export interface ActiveLoadRef {
  id: string;
  code: string;
  status: string;
}

export interface MasterLoadHistoryRow {
  id: string;
  code: string;
  status: string;
  fleetType: 'own_fleet' | 'market';
  sourceType: string;
  date: string;
  tonnes: string;
  freightValue: string | null;
  customerName: string | null;
  loadingPointTitle: string | null;
  dropCity: string | null;
  stageLabel: string;
  stepNumber: number;
  totalSteps: number;
  progress: number;
}

type LoadWithPosting = LoadEntity & {
  posting?: (LoadPostingEntity & { customer?: CustomerEntity | null }) | null;
};

/** "In use right now. LOAD-1049 is still running." — shared by the customer, transporter and
 *  loading-point retire/inactivate guards, and the "Loads" lists on their detail drawers. */
export class MasterUsageRepository {
  constructor(private readonly dataSource: DataSource) {}

  private scoped(
    tenantId: string,
    target: MasterUsageTarget,
    query: SelectQueryBuilder<LoadEntity>,
  ): SelectQueryBuilder<LoadEntity> {
    query.where('load.tenant_id = :tenantId', { tenantId });
    switch (target.kind) {
      case 'transporter':
        return query.andWhere('load.transporter_id = :targetId', { targetId: target.id });
      case 'customer':
        return query.andWhere(
          new Brackets((qb) =>
            qb
              .where('usageReq.customer_id = :targetId')
              .orWhere('usagePosting.customer_id = :targetId'),
          ),
          { targetId: target.id },
        );
      case 'loading_point':
        return query.andWhere(
          new Brackets((qb) =>
            qb
              .where('usageReq.loading_point_id = :targetId')
              .orWhere('usagePosting.pickup_loading_point_id = :targetId')
              .orWhere('usagePosting.drop_loading_point_id = :targetId'),
          ),
          { targetId: target.id },
        );
      case 'product':
        // Products ride on a load's cargo mix, or on the requisition it was planned from.
        return query.andWhere(
          new Brackets((qb) =>
            qb
              .where(
                'EXISTS (SELECT 1 FROM loads.load_cargo_items usage_cargo WHERE usage_cargo.load_id = load.id AND usage_cargo.product_id = :targetId)',
              )
              .orWhere(
                'EXISTS (SELECT 1 FROM loads.requisition_items usage_req_item WHERE usage_req_item.requisition_id = load.requisition_id AND usage_req_item.product_id = :targetId)',
              ),
          ),
          { targetId: target.id },
        );
      case 'delivery_points':
        return query.andWhere(
          new Brackets((qb) =>
            qb
              .where('usageReq.customer_delivery_point_id IN (:...targetIds)')
              .orWhere('usagePosting.drop_customer_delivery_point_id IN (:...targetIds)'),
          ),
          { targetIds: target.ids },
        );
    }
  }

  private baseQuery(tenantId: string, target: MasterUsageTarget) {
    const query = this.dataSource
      .getRepository(LoadEntity)
      .createQueryBuilder('load')
      .leftJoin(RequisitionEntity, 'usageReq', 'usageReq.id = load.requisition_id')
      .leftJoin(LoadPostingEntity, 'usagePosting', 'usagePosting.id = load.posting_id');
    return this.scoped(tenantId, target, query);
  }

  /** Loads that are not yet closed and touch this record. Empty when the target is unused. */
  async activeLoads(
    tenantId: string,
    target: MasterUsageTarget,
    limit = 20,
  ): Promise<ActiveLoadRef[]> {
    if (target.kind === 'delivery_points' && !target.ids.length) return [];
    const rows = await this.baseQuery(tenantId, target)
      .andWhere('load.status IN (:...activeStatuses)', {
        activeStatuses: [...ACTIVE_LOAD_STATUSES],
      })
      .select(['load.id AS id', 'load.code AS code', 'load.status AS status'])
      .orderBy('load.created_at', 'DESC')
      .limit(limit)
      .getRawMany<ActiveLoadRef>();
    return rows;
  }

  /** Paginated load history for a customer/transporter detail drawer, newest first. */
  async loadHistory(
    tenantId: string,
    target: MasterUsageTarget,
    page: number,
    limit: number,
  ): Promise<{ items: MasterLoadHistoryRow[]; total: number }> {
    const query = this.baseQuery(tenantId, target)
      .leftJoinAndSelect('load.requisition', 'req')
      .leftJoinAndSelect('req.customer', 'reqCustomer')
      .leftJoinAndSelect('req.loadingPoint', 'reqLoadingPoint')
      .leftJoinAndSelect('req.customerDeliveryPoint', 'reqDeliveryPoint')
      .leftJoinAndMapOne(
        'load.posting',
        LoadPostingEntity,
        'posting',
        'posting.id = load.posting_id',
      )
      .leftJoinAndMapOne(
        'posting.customer',
        CustomerEntity,
        'postingCustomer',
        'postingCustomer.id = posting.customer_id',
      )
      .orderBy('load.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [loads, total] = await query.getManyAndCount();
    return { items: (loads as LoadWithPosting[]).map(toHistoryRow), total };
  }
}

function toHistoryRow(load: LoadWithPosting): MasterLoadHistoryRow {
  const req = load.requisition;
  const posting = load.posting ?? null;
  const next = buildNextAction(load);
  return {
    id: load.id,
    code: load.code,
    status: load.status,
    fleetType: load.sourceType === 'own_fleet' ? 'own_fleet' : 'market',
    sourceType: load.sourceType,
    date: load.createdAt.toISOString(),
    tonnes: load.plannedCapacityTonnes,
    // Trip total — per-ton rates multiplied out, same as the advance/balance maths.
    freightValue: load.freightValue ? computeShareAmount(load, '100') : null,
    customerName: req?.customer?.name ?? posting?.customer?.name ?? null,
    loadingPointTitle: req?.loadingPoint?.title ?? posting?.pickupAddress?.label ?? null,
    dropCity: req?.customerDeliveryPoint?.city ?? posting?.dropAddress?.city ?? null,
    stageLabel: next.currentStageLabel,
    stepNumber: next.stepNumber,
    totalSteps: next.totalSteps,
    progress: next.totalSteps ? Math.min(1, next.stepNumber / next.totalSteps) : 0,
  };
}
