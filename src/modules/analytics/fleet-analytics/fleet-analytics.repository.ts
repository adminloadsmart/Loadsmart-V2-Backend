import {
  Between,
  DataSource,
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
} from 'typeorm';
import {
  FleetAnalyticsDateRange,
  FleetEmiSummary,
  FleetSourceMix,
} from './utils/fleet-analytics.interface';
import { LoadEntity } from '../../loads/entities/load.entity';
import { VehicleTelemetryMetaEntity } from '../../masters/vehicle/entities/vehicle-telemetry-meta.entity';

/** createdAt window for getSourceMix — `to` is a plain date (e.g. "2026-08-31"), extended to
 *  end-of-day so that whole day's loads are included, not just an exact-midnight match. */
function toCreatedAtWhere(
  range: FleetAnalyticsDateRange,
): Pick<FindOptionsWhere<LoadEntity>, 'createdAt'> {
  const from = range.from ? new Date(`${range.from}T00:00:00.000Z`) : undefined;
  const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : undefined;
  if (from && to) return { createdAt: Between(from, to) };
  if (from) return { createdAt: MoreThanOrEqual(from) };
  if (to) return { createdAt: LessThanOrEqual(to) };
  return {};
}

// Reads LoadEntity/VehicleTelemetryMetaEntity directly via the DataSource, same as
// AnalyticsRepository (shipper analytics) — a reporting concern spanning masters/loads, not a
// business-logic dependency, so it doesn't go through those modules' own repositories/services.
// Plain Repository.find() + in-JS aggregation throughout (no createQueryBuilder/raw SQL
// expressions) — see prefer-typeorm-no-raw-sql: TypeORM's Repository API has no SUM/GROUP BY,
// so aggregation happens in application code instead of in the query.
export class FleetAnalyticsRepository {
  private readonly loads;
  private readonly vehicleTelemetryMeta;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.vehicleTelemetryMeta = dataSource.getRepository(VehicleTelemetryMetaEntity);
  }

  /** "EMI outgo" tile — sums emiAmount across vehicles currently on finance (amount set, and
   *  emiEndDate either unset or not yet passed), for still-active vehicles only. */
  async getEmiSummary(tenantId: string): Promise<FleetEmiSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const base = {
      tenantId,
      deletedAt: IsNull(),
      emiAmount: MoreThan('0'),
      vehicle: { deletedAt: IsNull() },
    } satisfies FindOptionsWhere<VehicleTelemetryMetaEntity>;

    const rows = await this.vehicleTelemetryMeta.find({
      where: [
        { ...base, emiEndDate: IsNull() },
        { ...base, emiEndDate: MoreThanOrEqual(today) },
      ],
      relations: { vehicle: true },
      select: { id: true, emiAmount: true, vehicle: { id: true } },
    });

    return {
      totalEmiAmount: rows.reduce((sum, row) => sum + Number(row.emiAmount ?? 0), 0),
      vehiclesOnFinance: rows.length,
    };
  }

  /** "Own vs market mix" donut — counts by sourceType, optionally windowed to createdAt
   *  between from/to (either or both may be omitted for all-time counts). */
  async getSourceMix(tenantId: string, range: FleetAnalyticsDateRange): Promise<FleetSourceMix> {
    const rows = await this.loads.find({
      where: { tenantId, ...toCreatedAtWhere(range) },
      select: { id: true, sourceType: true },
    });

    return rows.reduce(
      (acc, row) => {
        if (row.sourceType === 'own_fleet') acc.ownFleet += 1;
        else acc.market += 1;
        return acc;
      },
      { ownFleet: 0, market: 0 },
    );
  }
}
