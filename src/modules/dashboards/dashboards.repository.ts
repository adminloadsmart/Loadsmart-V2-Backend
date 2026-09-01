import { DataSource, SelectQueryBuilder } from 'typeorm';
import { DateRange } from '../../shared/utils/date-filter';
import { LoadEntity } from '../loads/entities/load.entity';
import {
  ACTIVE_LOAD_STATUSES,
  COMPLETED_LOAD_STATUSES,
  LoadStatus,
} from '../loads/utils/loads.types';
import { LoadsSummaryDailyRow, LoadsSummaryTripCounts } from './utils/dashboards.interface';

// Groups load.created_at into its IST (Asia/Kolkata) calendar day, not the UTC day. `AT TIME
// ZONE 'Asia/Kolkata'` on a timestamptz produces a plain (zone-less) timestamp already expressed
// in IST wall-clock time, so the subsequent `::date` cast is a pure truncation — unlike casting a
// timestamptz straight to `date`, it does NOT depend on the DB session's `TimeZone` GUC (this
// project's DataSource, db/data-source.ts, sets no `timezone` option). Declared once and reused
// in both the SELECT and GROUP BY below so they can't drift textually (Postgres requires the
// grouped expression to match exactly).
const IST_DAY_EXPR = `(load.created_at AT TIME ZONE 'Asia/Kolkata')::date`;

function applyTenantAndRange(
  query: SelectQueryBuilder<LoadEntity>,
  tenantId: string,
  range: DateRange,
): SelectQueryBuilder<LoadEntity> {
  return query
    .where('load.tenant_id = :tenantId', { tenantId })
    .andWhere('load.created_at >= :from', { from: range.from })
    .andWhere('load.created_at <= :to', { to: range.to });
}

/**
 * Reads LoadEntity directly via the DataSource, same as ShipperAnalyticsRepository/
 * FleetAnalyticsRepository/DriverAnalyticsRepository — a reporting concern, not a business-logic
 * dependency, so it bypasses LoadRepository/LoadService. Backs the Home screen's loads-summary
 * endpoint (dashboards.service.ts's getLoadsSummary).
 */
export class DashboardsRepository {
  private readonly loads;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
  }

  /** Home screen trip counts — {all, active, completed} for every load in `range` regardless of
   *  status. Mirrors LoadRepository.countByGroup: one GROUP BY load.status query, reduced in JS
   *  using COMPLETED_LOAD_STATUSES (anything not "completed" counts as "active" —
   *  LOAD_STATUS_GROUPS is an exhaustive 2-way partition, see loads.types.ts), so `all` is always
   *  `active + completed` by construction. */
  async getTripCounts(tenantId: string, range: DateRange): Promise<LoadsSummaryTripCounts> {
    const query = this.loads
      .createQueryBuilder('load')
      .select('load.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('load.status');
    const rows = await applyTenantAndRange(query, tenantId, range).getRawMany<{
      status: LoadStatus;
      count: string;
    }>();

    const completedStatuses: readonly string[] = COMPLETED_LOAD_STATUSES;
    return rows.reduce<LoadsSummaryTripCounts>(
      (acc, row) => {
        const count = Number(row.count);
        acc.all += count;
        if (completedStatuses.includes(row.status)) acc.completed += count;
        else acc.active += count;
        return acc;
      },
      { all: 0, active: 0, completed: 0 },
    );
  }

  /** One row per IST calendar day that has >=1 load in `range` — sparse (no zero-fill; that's
   *  dashboards.service.ts's job) and unfiltered by status, same scope as getTripCounts. Backs
   *  all three Home-screen charts (loads/day, tonnes/day, freight/day) from a single GROUP BY
   *  query rather than three round trips. */
  async getDailyAggregates(tenantId: string, range: DateRange): Promise<LoadsSummaryDailyRow[]> {
    const query = this.loads
      .createQueryBuilder('load')
      .select(IST_DAY_EXPR, 'day')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(load.planned_capacity_tonnes), 0)', 'tonnes')
      .addSelect('COALESCE(SUM(load.freight_value), 0)', 'freightAmount')
      .groupBy(IST_DAY_EXPR)
      .orderBy('day', 'ASC');
    const rows = await applyTenantAndRange(query, tenantId, range).getRawMany<{
      day: Date;
      count: string;
      tonnes: string;
      freightAmount: string;
    }>();

    // `day` comes back from node-postgres's default `date` text parser as a JS Date anchored at
    // UTC midnight for that calendar date. `.toISOString().slice(0, 10)` is therefore safe and
    // gives back the exact 'YYYY-MM-DD' Postgres computed, regardless of the Node process's own
    // timezone — unlike resolveDateRange's from/to (IST-instant boundaries, not yet collapsed to
    // a calendar date), which must go through ist-time.ts's toIstDateString instead, never this.
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      count: Number(row.count),
      tonnes: Number(row.tonnes),
      freightAmount: Number(row.freightAmount),
    }));
  }

  /** Live count (not scoped to any date range, same as fleet-activity's operationalBreakdown) of
   *  loads currently in an active (non-completed) status with a vehicle assigned — i.e. trips a
   *  fleet vehicle is actually out running right now. */
  async countActiveTripsWithVehicle(tenantId: string): Promise<number> {
    const activeStatuses: readonly string[] = ACTIVE_LOAD_STATUSES;
    return this.loads
      .createQueryBuilder('load')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere('load.status IN (:...activeStatuses)', { activeStatuses })
      .andWhere('load.vehicle_id IS NOT NULL')
      .getCount();
  }
}
