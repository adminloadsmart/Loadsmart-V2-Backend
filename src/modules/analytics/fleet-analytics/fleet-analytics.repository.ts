import { DataSource } from 'typeorm';
import {
  FleetAnalyticsDateRange,
  FleetEmiSummary,
  FleetSourceMix,
} from './utils/fleet-analytics.interface';
import { LoadEntity } from '../../loads/entities/load.entity';
import { VehicleEntity } from '../../masters/entities/vehicle.entity';
import { LoadSourceType } from '../../loads/utils/loads.types';
import { VehicleTelemetryMetaEntity } from '../../masters/entities/vehicle-telemetry-meta.entity';

// Reads LoadEntity/VehicleEntity/VehicleTelemetryMetaEntity directly via the DataSource, same
// as AnalyticsRepository (shipper analytics) — a reporting concern spanning masters/loads, not
// a business-logic dependency, so it doesn't go through those modules' own repositories/services.
export class FleetAnalyticsRepository {
  private readonly loads;
  private readonly vehicleTelemetryMeta;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.vehicleTelemetryMeta = dataSource.getRepository(VehicleTelemetryMetaEntity);
  }

  /** "EMI outgo" tile — sums emi_amount across vehicles currently on finance (amount set, and
   *  emi_end_date either unset or not yet passed), for still-active vehicles only. */
  async getEmiSummary(tenantId: string): Promise<FleetEmiSummary> {
    const row = await this.vehicleTelemetryMeta
      .createQueryBuilder('telemetry')
      .innerJoin(VehicleEntity, 'vehicle', 'vehicle.id = telemetry.vehicle_id')
      .select('COALESCE(SUM(telemetry.emi_amount), 0)', 'totalEmiAmount')
      .addSelect('COUNT(*)', 'vehiclesOnFinance')
      .where('telemetry.tenant_id = :tenantId', { tenantId })
      .andWhere('telemetry.deleted_at IS NULL')
      .andWhere('vehicle.deleted_at IS NULL')
      .andWhere('telemetry.emi_amount IS NOT NULL')
      .andWhere('telemetry.emi_amount > 0')
      .andWhere('(telemetry.emi_end_date IS NULL OR telemetry.emi_end_date >= CURRENT_DATE)')
      .getRawOne<{ totalEmiAmount: string; vehiclesOnFinance: string }>();

    return {
      totalEmiAmount: Number(row?.totalEmiAmount ?? 0),
      vehiclesOnFinance: Number(row?.vehiclesOnFinance ?? 0),
    };
  }

  /** "Own vs market mix" donut — GROUP BY source_type, optionally windowed to createdAt
   *  between from/to (either or both may be omitted for all-time counts). */
  async getSourceMix(tenantId: string, range: FleetAnalyticsDateRange): Promise<FleetSourceMix> {
    const qb = this.loads
      .createQueryBuilder('load')
      .select('load.source_type', 'sourceType')
      .addSelect('COUNT(*)', 'count')
      .where('load.tenant_id = :tenantId', { tenantId })
      .groupBy('load.source_type');
    if (range.from) {
      qb.andWhere('load.created_at >= :from', { from: range.from });
    }
    if (range.to) {
      // `to` is a plain date (e.g. "2026-08-31"); cast so createdAt timestamps that same day
      // are included, not just an exact midnight match.
      qb.andWhere("load.created_at < (:to::date + INTERVAL '1 day')", { to: range.to });
    }

    const rows = await qb.getRawMany<{ sourceType: LoadSourceType; count: string }>();
    return rows.reduce(
      (acc, row) => {
        const count = Number(row.count);
        if (row.sourceType === 'own_fleet') acc.ownFleet += count;
        else acc.market += count;
        return acc;
      },
      { ownFleet: 0, market: 0 },
    );
  }
}
