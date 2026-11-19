import { Brackets, DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { BrokerEntity } from './broker.entity';
import type { BrokerStatus } from './broker.types';
import type { BrokerFilters } from './broker.validators';

export interface BrokerTotals {
  byStatus: Record<BrokerStatus, number>;
  all: number;
  withLoadsLast30Days: number;
  pendingOriginalPods: number;
  brokersWithPendingPods: number;
  onWhatsapp: number;
  notOnWhatsapp: number;
}

export class BrokerRepository {
  private readonly brokers: Repository<BrokerEntity>;

  constructor(dataSource: DataSource) {
    this.brokers = dataSource.getRepository(BrokerEntity);
  }

  /** Brokers matching the status tab and search, firm name A–Z. No `page` = every match. */
  list(
    filters: BrokerFilters,
    page?: { page: number; limit: number },
  ): Promise<[BrokerEntity[], number]> {
    const qb = this.filtered(filters).orderBy('b.trucker_company', 'ASC').addOrderBy('b.id');
    if (page) qb.skip((page.page - 1) * page.limit).take(page.limit);
    return qb.getManyAndCount();
  }

  /** The summary cards and tab counts — across every broker, not the current filter. */
  async totals(): Promise<BrokerTotals> {
    const row = await this.brokers
      .createQueryBuilder('b')
      .select('COUNT(*)::int', 'all')
      .addSelect(`COUNT(*) FILTER (WHERE b.status = 'approved')::int`, 'approved')
      .addSelect(`COUNT(*) FILTER (WHERE b.status = 'awaiting_approval')::int`, 'awaiting_approval')
      .addSelect(`COUNT(*) FILTER (WHERE b.status = 'on_hold')::int`, 'on_hold')
      .addSelect(`COUNT(*) FILTER (WHERE b.status = 'rejected')::int`, 'rejected')
      .addSelect('COUNT(*) FILTER (WHERE b.loads_last_30_days > 0)::int', 'withLoads')
      .addSelect('COALESCE(SUM(b.pending_original_pods), 0)::int', 'pods')
      .addSelect('COUNT(*) FILTER (WHERE b.pending_original_pods > 0)::int', 'podBrokers')
      .addSelect('COUNT(*) FILTER (WHERE b.is_on_whatsapp)::int', 'onWhatsapp')
      .getRawOne<Record<string, number>>();
    const r = row ?? {};
    return {
      all: r.all ?? 0,
      byStatus: {
        approved: r.approved ?? 0,
        awaiting_approval: r.awaiting_approval ?? 0,
        on_hold: r.on_hold ?? 0,
        rejected: r.rejected ?? 0,
      },
      withLoadsLast30Days: r.withLoads ?? 0,
      pendingOriginalPods: r.pods ?? 0,
      brokersWithPendingPods: r.podBrokers ?? 0,
      onWhatsapp: r.onWhatsapp ?? 0,
      notOnWhatsapp: (r.all ?? 0) - (r.onWhatsapp ?? 0),
    };
  }

  /** Search covers broker (firm) name, contact name, phone, base and lane. */
  private filtered({ status, search }: BrokerFilters): SelectQueryBuilder<BrokerEntity> {
    const qb = this.brokers.createQueryBuilder('b');
    if (status) qb.andWhere('b.status = :status', { status });
    if (search) {
      const term = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('b.trucker_company ILIKE :term', { term })
            .orWhere('b.trucker_name ILIKE :term')
            .orWhere('b.phone ILIKE :term')
            .orWhere('b.base ILIKE :term')
            .orWhere('b.lane_origin ILIKE :term')
            .orWhere(`array_to_string(b.lane_destinations, ',') ILIKE :term`);
        }),
      );
    }
    return qb;
  }
}
