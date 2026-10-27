import { JobQueue } from '../../jobs/queue-registry';
import { daysBetween } from '../maintenance/calculations/dates';
import { dailyFixedCost } from '../maintenance/calculations/downtime';
import { organizationDisplayName } from '../organization/organization.constants';
import {
  COMPLIANCE_MANAGE,
  CUSTOMERS_APPROVE,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  MASTERS_APPROVE,
} from '../../shared/constants/permissions';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import {
  DAILY_BRIEF_STATIC,
  DailyBriefContext,
  VehicleIdleWeeklyContext,
} from './catalog/notification-catalog';
import { countPendingApprovals } from './master-approvals';
import { INDIA_TIME_ZONE } from './notifications.constants';
import { DigestsDeps, IdleVehicle } from './notifications.interface';
import { indiaDate } from './utils/trip-time';

/**
 * Digests — roll-ups that run on the 'notification-schedules' queue (see
 * vehicle-document-alerts.ts's schedule worker), never as individual alerts:
 *  - LS_N_0059 "vehicle idle too long": Monday 9:00 IST, one per organisation.
 *  - LS_N_0060 "daily morning brief": 07:30 IST Monday–Saturday (no holiday calendar or org
 *    time zone exists yet), one per active org user, each count filtered to their permissions.
 */
const IDLE_WEEKLY_JOB = 'idle-vehicles-weekly';
const DAILY_BRIEF_JOB = 'daily-brief';
const IDLE_WEEKLY_TYPE = 'vehicle.idle_weekly';
const DAILY_BRIEF_TYPE = 'digest.daily_brief';
/** LS_N_0059's "configured days" — nothing is configurable yet, so a fixed constant. */
export const IDLE_DAYS = 3;

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/** Registers both cron schedules (idempotent — safe on every boot / every instance). */
export async function scheduleDigests(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(IDLE_WEEKLY_JOB, '0 9 * * 1', INDIA_TIME_ZONE, IDLE_WEEKLY_JOB);
  await queue.upsertSchedule(DAILY_BRIEF_JOB, '30 7 * * 1-6', INDIA_TIME_ZONE, DAILY_BRIEF_JOB);
}

export function createDigests(deps: DigestsDeps) {
  const { scheduledAlertRepository, triggers } = deps;

  return {
    /** LS_N_0059 — per organisation, the longest-idle vehicle headlines; the rest are counted. */
    async runIdleWeekly(today: string) {
      const idleVehiclesByTenant = new Map<string, IdleVehicle[]>();
      for (const vehicle of await scheduledAlertRepository.findFreeVehicles(today)) {
        const lastTripDate = indiaDate(vehicle.lastTripAt);
        const idleDays = daysBetween(lastTripDate, today);
        if (idleDays <= IDLE_DAYS) continue;
        idleVehiclesByTenant.set(vehicle.tenantId, [
          ...(idleVehiclesByTenant.get(vehicle.tenantId) ?? []),
          { ...vehicle, lastTripDate, idleDays },
        ]);
      }
      for (const [tenantId, idleVehicles] of idleVehiclesByTenant) {
        const [longestIdle] = [...idleVehicles].sort(
          (first, second) => second.idleDays - first.idleDays,
        );
        const { perDay } = dailyFixedCost(longestIdle.fixedCostMonthly, longestIdle.emiAmount);
        await triggers.enqueue(IDLE_WEEKLY_TYPE, tenantId, {
          vehicleId: longestIdle.vehicleId,
          vehicleNo: longestIdle.vehicleNo,
          idleDays: longestIdle.idleDays,
          lastTripDate: longestIdle.lastTripDate,
          fixedCostPerDay: perDay > 0 ? rupees(perDay) : null,
          idleCost: perDay > 0 ? rupees(perDay * longestIdle.idleDays) : null,
          otherIdleCount: idleVehicles.length - 1,
          runDate: today,
        });
      }
      return { idleOrganisations: idleVehiclesByTenant.size };
    },

    /** LS_N_0060 — one brief per active org user, counts filtered to what they can see. */
    async runDailyBrief(today: string) {
      const organizations = await scheduledAlertRepository.listActiveOrganizations();
      const freeVehicles = await scheduledAlertRepository.findFreeVehicles(today);
      let sentCount = 0;
      for (const organization of organizations) {
        const counts = await scheduledAlertRepository.countDailyBrief(organization.id, today);
        const emptyVehicles = freeVehicles.filter(
          (vehicle) => vehicle.tenantId === organization.id,
        ).length;
        for (const user of await scheduledAlertRepository.listOrganizationUsers(organization.id)) {
          const can = (permission: string) => user.permissions.includes(permission);
          const canApprove =
            can(MASTERS_APPROVE) || (can(CUSTOMERS_APPROVE) && user.role === ORG_ADMIN_ROLE);
          const podsPending = can(LOADS_DOCUMENTS_MANAGE) ? counts.pods : undefined;
          const approvalsPending = canApprove
            ? await countPendingApprovals(
                scheduledAlertRepository,
                organization.id,
                user.permissions,
                user.role,
              )
            : undefined;
          const vehiclesBlocked =
            can(COMPLIANCE_MANAGE) || can(DISPATCH_PLANNING_MANAGE) ? counts.blocked : undefined;
          const seesFleet = can(DISPATCH_PLANNING_MANAGE);
          // Static tokens (DAILY_BRIEF_STATIC) never count towards "needs you" or the skip rule.
          const needsAction = (podsPending ?? 0) + (approvalsPending ?? 0) + (vehiclesBlocked ?? 0);
          if (counts.running + needsAction + (seesFleet ? emptyVehicles : 0) === 0) continue;
          await triggers.enqueue(DAILY_BRIEF_TYPE, organization.id, {
            userId: user.id,
            orgName: organizationDisplayName(organization),
            tripsRunning: counts.running,
            arrivingToday: DAILY_BRIEF_STATIC.arrivingToday,
            delayed: DAILY_BRIEF_STATIC.delayed,
            podsPending,
            approvalsPending,
            vehiclesBlocked,
            emptyVehicles: seesFleet ? emptyVehicles : undefined,
            idleLocations: seesFleet ? DAILY_BRIEF_STATIC.idleLocations : undefined,
            needsAction,
            runDate: today,
          });
          sentCount += 1;
        }
      }
      return { dailyBriefs: sentCount };
    },

    /** Relevance checks — re-running a digest the same day never sends it twice. */
    idleWeeklyNotSent: async (tenantId: string, context: VehicleIdleWeeklyContext) =>
      !(await scheduledAlertRepository.hasSentNotification(tenantId, IDLE_WEEKLY_TYPE, {
        run_date: context.runDate,
      })),
    dailyBriefNotSent: async (tenantId: string, context: DailyBriefContext) =>
      !(await scheduledAlertRepository.hasSentNotification(
        tenantId,
        DAILY_BRIEF_TYPE,
        { run_date: context.runDate },
        context.userId,
      )),
  };
}

/** Job name → runner, for the schedule worker. */
export function digestJobs(digests: ReturnType<typeof createDigests>) {
  return {
    [IDLE_WEEKLY_JOB]: (today: string) => digests.runIdleWeekly(today),
    [DAILY_BRIEF_JOB]: (today: string) => digests.runDailyBrief(today),
  };
}
