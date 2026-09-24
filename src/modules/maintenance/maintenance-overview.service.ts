import { rethrow } from '../../shared/errors';
import { MaintenanceJobRepository } from './repositories/maintenance-job.repository';
import { dailyFixedCost, downtimeDaysInWindow, money } from './calculations/downtime';
import { round } from './calculations/dates';
import { DEFAULT_OVERVIEW_FILTER } from './maintenance.constants';
import { PeriodInput } from './maintenance.interface';
import { MaintenanceService } from './maintenance.service';
import { TyreService } from './tyre.service';

/**
 * The four headline numbers and the one-line dispatch consequence.
 *
 * Spend and downtime happened, so they follow the period. Service due and tyres are the state of
 * the fleet right now, so they don't — and they are counted from the very queue builders behind
 * them, so a headline can never disagree with its queue (acceptance criterion 3).
 *
 * The two money headlines are only built for a seat that may see cost; the two workshop
 * headlines go to everybody (acceptance criterion 4).
 */
export class MaintenanceOverviewService {
  constructor(
    private readonly jobRepository: MaintenanceJobRepository,
    private readonly maintenanceService: MaintenanceService,
    private readonly tyreService: TyreService,
  ) {}

  async getOverview(tenantId: string, input: PeriodInput, canSeeCosts: boolean) {
    try {
      const range = this.maintenanceService.resolvePeriod(input);
      const now = new Date();

      const [serviceDue, tyres, consequence] = await Promise.all([
        this.maintenanceService.listServiceDue(tenantId),
        this.tyreService.listQueue(tenantId),
        this.maintenanceService.getWorkshopSnapshot(tenantId),
      ]);

      const trucksOverServicePolicy = {
        count: serviceDue.total,
        byDistance: serviceDue.items.filter((i) => i.trigger === 'distance' || i.trigger === 'both')
          .length,
        byTime: serviceDue.items.filter((i) => i.trigger === 'time' || i.trigger === 'both').length,
        noRecord: serviceDue.items.filter((i) => i.trigger === 'no_record').length,
      };

      const positionsAtLegalLimit = {
        count: tyres.atLegalLimit,
        underThirtyPct: tyres.underThirtyPct,
        legalFloorMm: tyres.legalFloorMm,
      };

      const period = {
        filter: input.filter ?? DEFAULT_OVERVIEW_FILTER,
        from: range.from,
        to: range.to,
        followsPeriod: ['maintenanceSpend', 'daysOffRoad', 'jobHistory'],
        currentState: ['serviceDue', 'breakdowns', 'tyres', 'batteries'],
      };

      if (!canSeeCosts) {
        return {
          period,
          headlines: { trucksOverServicePolicy, positionsAtLegalLimit },
          consequence,
        };
      }

      const [spendRows, overlapping] = await Promise.all([
        this.jobRepository.spendByType(tenantId, range),
        this.jobRepository.listOverlapping(tenantId, range),
      ]);

      const service = spendRows.find((row) => row.jobType === 'service');
      const breakdown = spendRows.find((row) => row.jobType === 'breakdown');
      const maintenanceSpend = {
        total: money((service?.total ?? 0) + (breakdown?.total ?? 0)),
        serviceCost: money(service?.total ?? 0),
        serviceCount: service?.count ?? 0,
        breakdownCost: money(breakdown?.total ?? 0),
        breakdownCount: breakdown?.count ?? 0,
      };

      let days = 0;
      let fixedCost = 0;
      const trucks = new Set<string>();
      for (const job of overlapping) {
        const jobDaysInWindow = downtimeDaysInWindow(job.openedAt, job.closedAt, range, now);
        if (jobDaysInWindow <= 0) continue;
        const fixed = dailyFixedCost(
          job.vehicle.telemetryMeta?.fixedCostMonthly,
          job.vehicle.telemetryMeta?.emiAmount,
        );
        days += jobDaysInWindow;
        fixedCost += jobDaysInWindow * fixed.perDay;
        trucks.add(job.vehicleId);
      }

      const daysOffRoad = {
        days: round(days, 1),
        fixedCost: money(fixedCost),
        trucks: trucks.size,
      };

      return {
        period,
        headlines: {
          maintenanceSpend,
          daysOffRoad,
          trucksOverServicePolicy,
          positionsAtLegalLimit,
        },
        consequence,
      };
    } catch (error) {
      rethrow(error, 'Failed to build maintenance overview');
    }
  }
}
