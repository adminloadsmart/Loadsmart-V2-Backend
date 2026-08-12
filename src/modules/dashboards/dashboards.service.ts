import { rethrow } from '../../shared/errors';
import { toDateString } from '../../shared/utils/date';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { VehicleService } from '../masters/vehicle.service';
import { DriverService } from '../masters/driver.service';
import { CustomerService } from '../customers/customer.service';
import { DEFAULT_RANGE_DAYS } from './dashboards.constants';
import {
  FleetActivityDateRange,
  FleetActivityRangeInput,
  FleetActivitySummary,
  ListPendingApprovalsResult,
  PendingApprovalItem,
} from './utils/dashboards.interface';

// Cap per type, not a real cross-type paginator — approval queues are small in practice, and
// correctly merging three independently-paginated lists into one ordered page is a lot of
// machinery for a queue this size. Revisit if that assumption stops holding.
const MAX_PENDING_PER_TYPE = 100;

/**
 * Composes read models directly via each module's index.ts — no owned schema, no gateways.
 * Only masters (vehicle operational status) has real data to read today; tracking, maintenance,
 * and payments are still schema-less stubs, so their stats stay `null` on FleetActivitySummary
 * until those modules gain dated distance/cost/earning records to aggregate over a range.
 */
export class DashboardsService {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly customerService: CustomerService,
  ) {}

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

  /** Settings → Approvals — every pending customer/vehicle/driver for the tenant, in one list. */
  async listPendingApprovals(
    tenantId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ListPendingApprovalsResult> {
    try {
      const [customers, vehicles, drivers] = await Promise.all([
        this.customerService.list(tenantId, actingUser.role, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending',
        }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending',
        }),
        this.driverService.listDrivers(tenantId, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending',
        }),
      ]);

      const items: PendingApprovalItem[] = [
        ...customers.items.map((customer) => ({
          type: 'customer' as const,
          id: customer.id,
          label: customer.name,
          requestedBy: customer.createdBy,
          requestedAt: customer.createdAt,
        })),
        ...vehicles.items.map((vehicle) => ({
          type: 'vehicle' as const,
          id: vehicle.id,
          label: vehicle.registrationNumber,
          requestedBy: vehicle.createdBy,
          requestedAt: vehicle.createdAt,
        })),
        ...drivers.items.map((driver) => ({
          type: 'driver' as const,
          id: driver.id,
          label: driver.fullName,
          requestedBy: driver.createdBy,
          requestedAt: driver.createdAt,
        })),
      ];

      items.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());

      return { items, total: items.length };
    } catch (error) {
      rethrow(error, 'Failed to list pending approvals');
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
