import { DataSource } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { LanePerformanceItem, TonnageByProductItem } from './utils/analytics.interface';

// A moved load is anything that has progressed beyond dispatch planning. Delivery-only
// metrics below still use delivered_at as their denominator, so active loads do not count as
// late or on-time before delivery has happened.
const MOVED_LOADS = `load.status <> 'created'`;

export class AnalyticsRepository {
  private readonly loads;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
  }

  async getCards(tenantId: string) {
    const row = await this.loads
      .createQueryBuilder('load')
      .select('COUNT(*)', 'loadsMoved')
      .addSelect('COALESCE(SUM(load.planned_capacity_tonnes), 0)', 'tonnage')
      .addSelect(
        `COALESCE(
          100.0 * SUM(
            CASE
              WHEN load.delivered_at IS NOT NULL
                AND load.delivered_at::date <= requisition.expected_delivery_date
              THEN 1 ELSE 0
            END
          ) / NULLIF(COUNT(load.delivered_at), 0),
          NULL
        )`,
        'onTimePercentage',
      )
      .innerJoin('load.requisition', 'requisition')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere(MOVED_LOADS)
      .getRawOne<{
        loadsMoved: string;
        tonnage: string;
        onTimePercentage: string;
      }>();

    return {
      loadsMoved: Number(row?.loadsMoved ?? 0),
      tonnage: Number(row?.tonnage ?? 0),
      onTimePercentage:
        row?.onTimePercentage === null || row?.onTimePercentage === undefined
          ? null
          : Number(row.onTimePercentage),
    };
  }

  async getTonnageByProduct(tenantId: string): Promise<TonnageByProductItem[]> {
    const rows = await this.loads
      .createQueryBuilder('load')
      .select('cargo.product_id', 'productId')
      .addSelect('product.product_details', 'productName')
      .addSelect('COALESCE(SUM(cargo.tonnes_per_truck), 0)', 'tonnes')
      .innerJoin('load.cargoItems', 'cargo')
      .innerJoin('cargo.product', 'product')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere(MOVED_LOADS)
      .groupBy('cargo.product_id')
      .addGroupBy('product.product_details')
      .orderBy('tonnes', 'DESC')
      .getRawMany<{ productId: string; productName: string; tonnes: string }>();

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      tonnes: Number(row.tonnes),
    }));
  }

  async getLanePerformance(tenantId: string): Promise<LanePerformanceItem[]> {
    const rows = await this.loads
      .createQueryBuilder('load')
      .select(
        `CONCAT_WS(
          ' - ',
          NULLIF(TRIM(loading_point.city), ''),
          NULLIF(TRIM(delivery_point.city), '')
        )`,
        'lane',
      )
      .addSelect('COUNT(*)', 'loads')
      .addSelect(
        'AVG(EXTRACT(EPOCH FROM (load.delivered_at - load.in_transit_at)) / 60)',
        'avgTatMinutes',
      )
      .addSelect(
        `100.0 * SUM(
          CASE
            WHEN load.delivered_at IS NOT NULL
              AND load.delivered_at::date <= requisition.expected_delivery_date
            THEN 1 ELSE 0
          END
        ) / NULLIF(COUNT(load.delivered_at), 0)`,
        'onTimePercentage',
      )
      .innerJoin('load.requisition', 'requisition')
      .innerJoin('requisition.loadingPoint', 'loading_point')
      .innerJoin('requisition.customerDeliveryPoint', 'delivery_point')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere(MOVED_LOADS)
      .groupBy('loading_point.city')
      .addGroupBy('delivery_point.city')
      .orderBy('loads', 'DESC')
      .getRawMany<{
        lane: string;
        loads: string;
        avgTatMinutes: string | null;
        onTimePercentage: string | null;
      }>();

    return rows.map((row) => ({
      lane: row.lane,
      loads: Number(row.loads),
      avgTatMinutes: row.avgTatMinutes === null ? null : Number(row.avgTatMinutes),
      onTimePercentage: row.onTimePercentage === null ? null : Number(row.onTimePercentage),
      avgKm: null,
    }));
  }
}
