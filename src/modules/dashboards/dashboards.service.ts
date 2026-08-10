import { rethrow } from '../../shared/errors';
import { toDateString } from '../../shared/utils/date';
import { VehicleService } from '../masters/vehicle.service';
import { DEFAULT_RANGE_DAYS } from './dashboards.constants';
import {
  FleetActivityDateRange,
  FleetActivityRangeInput,
  FleetActivitySummary,
} from './utils/dashboards.interface';

/**
 * Composes read models directly via each module's index.ts — no owned schema, no gateways.
 * Only masters (vehicle operational status) has real data to read today; tracking, maintenance,
 * and payments are still schema-less stubs, so their stats stay `null` on FleetActivitySummary
 * until those modules gain dated distance/cost/earning records to aggregate over a range.
 */
export class DashboardsService {
  constructor(private readonly vehicleService: VehicleService) {}

  async getFleetActivity(
    tenantId: string,
    input: FleetActivityRangeInput,
  ): Promise<FleetActivitySummary> {
    try {
      const range = this.resolveRange(input);

      // Reuses vehicleService.listVehicles' existing tenant-scoping/soft-delete filtering rather
      // than adding a parallel counting query — `limit: 1` keeps each call cheap while `.total`
      // (from the underlying findAndCount) still reflects the full matching count.
      const [all, onTrip, idle, warnOnAssign, inactive] = await Promise.all([
        this.vehicleService.listVehicles(tenantId, { page: 1, limit: 1 }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: 1,
          operationalStatus: 'on_trip',
        }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: 1,
          operationalStatus: 'idle',
        }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: 1,
          operationalStatus: 'warn_on_assign',
        }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: 1,
          operationalStatus: 'inactive',
        }),
      ]);

      return {
        range,
        fleetSize: all.total,
        trucksRunningNow: onTrip.total,
        operationalBreakdown: {
          onTrip: onTrip.total,
          idle: idle.total,
          warnOnAssign: warnOnAssign.total,
          inactive: inactive.total,
        },
        kmCovered: null,
        maintenanceCost: null,
        fleetPnl: null,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet activity');
    }
  }

  /** Defaults to the last DEFAULT_RANGE_DAYS days (inclusive of today) when the caller omits a range. */
  private resolveRange(input: FleetActivityRangeInput): FleetActivityDateRange {
    if (input.from && input.to) return { from: input.from, to: input.to };

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (DEFAULT_RANGE_DAYS - 1));

    return { from: input.from ?? toDateString(from), to: input.to ?? toDateString(to) };
  }
}
