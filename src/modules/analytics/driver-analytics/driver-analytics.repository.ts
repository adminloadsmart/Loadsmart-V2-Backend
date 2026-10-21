import {
  Between,
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { ACTIVE_LOAD_STATUSES } from '../../loads/utils/loads.types';
import { DriverEntity } from '../../driver/entities/driver.entity';
import { DriverTenantRelationEntity } from '../../driver/entities/driver-tenant-relation.entity';
import { FleetDriverLinkEntity } from '../../masters/fleet-driver-link/entities/fleet-driver-link.entity';
import {
  DriverAnalyticsDateRange,
  DriverAnalyticsHeader,
  DriverAnalyticsTrendPoint,
  DriverAnalyticsTripStats,
} from './utils/driver-analytics.interface';

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** createdAt window — `to` is a plain date (e.g. "2026-08-31"), extended to end-of-day so that
 *  whole day's loads are included, not just an exact-midnight match. */
function toCreatedAtWhere(
  range: DriverAnalyticsDateRange,
): Pick<FindOptionsWhere<LoadEntity>, 'createdAt'> {
  const from = range.from ? new Date(`${range.from}T00:00:00.000Z`) : undefined;
  const to = range.to ? new Date(`${range.to}T23:59:59.999Z`) : undefined;
  if (from && to) return { createdAt: Between(from, to) };
  if (from) return { createdAt: MoreThanOrEqual(from) };
  if (to) return { createdAt: LessThanOrEqual(to) };
  return {};
}

/** A load is "on time" when it's been delivered and that happened on or before the requisition's
 *  committed date — date-level only, since no entity anywhere stores a committed delivery time. */
function isOnTime(load: LoadEntity): boolean {
  if (!load.deliveredAt) return false;
  const deliveredDate = load.deliveredAt.toISOString().slice(0, 10);
  // Loads posted without a requisition carry no committed date, so they never count as late.
  return load.requisition ? deliveredDate <= load.requisition.expectedDeliveryDate : true;
}

function toTripStats(loads: LoadEntity[]): DriverAnalyticsTripStats {
  const delivered = loads.filter((load) => load.deliveredAt !== null);
  const onTime = delivered.filter(isOnTime).length;
  return {
    total: loads.length,
    onTime,
    late: delivered.length - onTime,
    onTimePercentage: delivered.length ? (onTime / delivered.length) * 100 : null,
  };
}

// Reads DriverEntity/FleetDriverLinkEntity/LoadEntity directly via the DataSource, same as
// FleetAnalyticsRepository — a reporting concern spanning masters/loads, not a business-logic
// dependency. Plain Repository.find()/findOne() + in-JS aggregation throughout (no
// createQueryBuilder/raw SQL expressions) — see prefer-typeorm-no-raw-sql.
export class DriverAnalyticsRepository {
  private readonly drivers;
  private readonly driverTenantRelations;
  private readonly fleetDriverLinks;
  private readonly loads;

  constructor(dataSource: DataSource) {
    this.drivers = dataSource.getRepository(DriverEntity);
    this.driverTenantRelations = dataSource.getRepository(DriverTenantRelationEntity);
    this.fleetDriverLinks = dataSource.getRepository(FleetDriverLinkEntity);
    this.loads = dataSource.getRepository(LoadEntity);
  }

  async getHeader(tenantId: string, driverId: string): Promise<DriverAnalyticsHeader | null> {
    const relation = await this.driverTenantRelations.findOneBy({
      tenantId,
      driverId,
      deletedAt: IsNull(),
    });
    if (!relation) return null;
    const driver = await this.drivers.findOneBy({ id: driverId, deletedAt: IsNull() });
    if (!driver) return null;

    const link = await this.fleetDriverLinks.findOne({
      where: { tenantId, driverId, isPrimary: true, status: 'active', deletedAt: IsNull() },
      relations: { vehicle: true },
    });

    const yearsExperience = driver.dateOfJoining
      ? Math.floor((Date.now() - new Date(driver.dateOfJoining).getTime()) / MS_PER_YEAR)
      : null;

    return {
      id: driver.id,
      fullName: driver.fullName,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry,
      yearsExperience,
      currentVehicle: link
        ? { id: link.vehicle.id, registrationNumber: link.vehicle.registrationNumber }
        : null,
    };
  }

  /** Trip count/on-time/late for the driver, plus a monthly on-time trend bucketed by
   *  deliveredAt. One fetch (loads + their requisition's expectedDeliveryDate), both derived
   *  from it in application code. */
  async getTripStatsAndTrend(
    tenantId: string,
    driverId: string,
    range: DriverAnalyticsDateRange,
  ): Promise<{ stats: DriverAnalyticsTripStats; trend: DriverAnalyticsTrendPoint[] }> {
    const loads = await this.loads.find({
      where: { tenantId, driverId, ...toCreatedAtWhere(range) },
      relations: { requisition: true },
    });

    const stats = toTripStats(loads);
    const delivered = loads.filter((load) => load.deliveredAt !== null);

    const byMonth = new Map<string, { tripsCount: number; onTime: number }>();
    for (const load of delivered) {
      const month = load.deliveredAt!.toISOString().slice(0, 7);
      const bucket = byMonth.get(month) ?? { tripsCount: 0, onTime: 0 };
      bucket.tripsCount += 1;
      if (isOnTime(load)) bucket.onTime += 1;
      byMonth.set(month, bucket);
    }

    const trend: DriverAnalyticsTrendPoint[] = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        tripsCount: bucket.tripsCount,
        onTimePercentage: bucket.tripsCount ? (bucket.onTime / bucket.tripsCount) * 100 : null,
      }));

    return { stats, trend };
  }

  /** All-time trip stats for several drivers in one fetch — the My Drivers list's Trips · On time
   *  column. Drivers with no loads are absent from the map. */
  async getTripStatsForDrivers(
    tenantId: string,
    driverIds: string[],
  ): Promise<Map<string, DriverAnalyticsTripStats>> {
    if (!driverIds.length) return new Map();
    const loads = await this.loads.find({
      where: { tenantId, driverId: In(driverIds) },
      relations: { requisition: true },
    });
    const byDriver = new Map<string, LoadEntity[]>();
    for (const load of loads) {
      byDriver.set(load.driverId!, [...(byDriver.get(load.driverId!) ?? []), load]);
    }
    return new Map([...byDriver].map(([driverId, rows]) => [driverId, toTripStats(rows)]));
  }

  /** Every non-closed own-fleet load in the tenant, newest first — the roster's live
   *  on-trip/available split. Bounded by fleet size, so one fetch serves every row and tab count. */
  findActiveDriverLoads(tenantId: string): Promise<LoadEntity[]> {
    return this.loads.find({
      where: { tenantId, driverId: Not(IsNull()), status: In([...ACTIVE_LOAD_STATUSES]) },
      select: { id: true, code: true, status: true, driverId: true, createdAt: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** The driver's newest non-closed load — the live "is this driver on a load right now" check.
   *  Load assignment never touches driver_operational_status, so that row alone can't answer it. */
  findActiveLoadForDriver(tenantId: string, driverId: string): Promise<LoadEntity | null> {
    return this.loads.findOne({
      where: { tenantId, driverId, status: In([...ACTIVE_LOAD_STATUSES]) },
      order: { createdAt: 'DESC' },
    });
  }
}
