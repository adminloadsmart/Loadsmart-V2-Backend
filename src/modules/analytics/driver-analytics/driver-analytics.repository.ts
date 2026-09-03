import {
  Between,
  DataSource,
  FindOptionsWhere,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { DriverEntity } from '../../masters/driver/entities/driver.entity';
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
  return deliveredDate <= load.requisition.expectedDeliveryDate;
}

// Reads DriverEntity/FleetDriverLinkEntity/LoadEntity directly via the DataSource, same as
// FleetAnalyticsRepository — a reporting concern spanning masters/loads, not a business-logic
// dependency. Plain Repository.find()/findOne() + in-JS aggregation throughout (no
// createQueryBuilder/raw SQL expressions) — see prefer-typeorm-no-raw-sql.
export class DriverAnalyticsRepository {
  private readonly drivers;
  private readonly fleetDriverLinks;
  private readonly loads;

  constructor(dataSource: DataSource) {
    this.drivers = dataSource.getRepository(DriverEntity);
    this.fleetDriverLinks = dataSource.getRepository(FleetDriverLinkEntity);
    this.loads = dataSource.getRepository(LoadEntity);
  }

  async getHeader(tenantId: string, driverId: string): Promise<DriverAnalyticsHeader | null> {
    const driver = await this.drivers.findOneBy({ id: driverId, tenantId, deletedAt: IsNull() });
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

    const delivered = loads.filter((load) => load.deliveredAt !== null);
    const onTimeLoads = delivered.filter(isOnTime);

    const stats: DriverAnalyticsTripStats = {
      total: loads.length,
      onTime: onTimeLoads.length,
      late: delivered.length - onTimeLoads.length,
      onTimePercentage: delivered.length ? (onTimeLoads.length / delivered.length) * 100 : null,
    };

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
}
