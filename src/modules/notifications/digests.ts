import { DataSource } from 'typeorm';
import { JobQueue } from '../../jobs/queue-registry';
import { dailyFixedCost } from '../maintenance/calculations/downtime';
import { OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance/maintenance.types';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../masters/vehicle/vehicle.type';
import {
  COMPLIANCE_MANAGE,
  CUSTOMERS_APPROVE,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  MASTERS_APPROVE,
} from '../../shared/constants/permissions';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { DAILY_BRIEF_STATIC } from './catalog/notification-catalog';
import { countPendingApprovals } from './master-approvals';
import { NotificationTriggers } from './notification-triggers';

/**
 * Digests — roll-ups that run on the 'notification-schedules' queue (see
 * vehicle-document-alerts.ts's schedule worker), never as individual alerts:
 *  - LS_N_0059 "vehicle idle too long": Monday 9:00 IST, one per organisation.
 *  - LS_N_0060 "daily morning brief": 07:30 IST Monday–Saturday (no holiday calendar or org
 *    time zone exists yet), one per active org user, each count filtered to their permissions.
 */
const IDLE_WEEKLY_JOB = 'idle-vehicles-weekly';
const DAILY_BRIEF_JOB = 'daily-brief';
const TIMEZONE = 'Asia/Kolkata';
/** LS_N_0059's "configured days" — nothing is configurable yet, so a fixed constant. */
export const IDLE_DAYS = 3;

/** Trip stages counted as "on road" (left the plant, not yet delivered). */
const RUNNING_STATUSES = ['in_transit', 'reached_delivery_point'];
/** At the delivery point and not yet delivered — the E-POD is what moves it to delivered. */
const POD_PENDING_STATUS = 'reached_delivery_point';
const ACTIVE_LOAD_SQL = `l.status NOT IN ('delivered', 'closed')`;

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Registers both cron schedules (idempotent — safe on every boot / every instance). */
export async function scheduleDigests(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(IDLE_WEEKLY_JOB, '0 9 * * 1', TIMEZONE, IDLE_WEEKLY_JOB);
  await queue.upsertSchedule(DAILY_BRIEF_JOB, '30 7 * * 1-6', TIMEZONE, DAILY_BRIEF_JOB);
}

interface IdleRow {
  tenant_id: string;
  vehicle_id: string;
  vehicle_no: string;
  last_trip_date: string;
  fixed_cost_monthly: string | null;
  emi_amount: string | null;
}

interface UserRow {
  id: string;
  role: string;
  permissions: string[];
}

export function createDigests(dataSource: DataSource, triggers: NotificationTriggers) {
  /** Own-fleet vehicles in service with no trip in hand; last trip = latest delivery/close of any
   *  of its loads, else the day it was added (never had one). */
  const freeVehicles = (today: string): Promise<IdleRow[]> =>
    dataSource.query(
      `SELECT v.tenant_id, v.id AS vehicle_id, v.registration_number AS vehicle_no,
              (COALESCE(
                 (SELECT max(COALESCE(l.delivered_at, l.closed_at, l.updated_at))
                    FROM loads.loads l WHERE l.vehicle_id = v.id),
                 v.created_at) AT TIME ZONE '${TIMEZONE}')::date::text AS last_trip_date,
              tm.fixed_cost_monthly, tm.emi_amount
         FROM masters.vehicles v
         LEFT JOIN masters.vehicle_telemetry_meta tm ON tm.vehicle_id = v.id AND tm.deleted_at IS NULL
        WHERE v.deleted_at IS NULL AND v.status = 'active' AND v.ownership_type = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM loads.loads l WHERE l.vehicle_id = v.id AND ${ACTIVE_LOAD_SQL})
          AND v.created_at::date <= $2::date
        ORDER BY v.registration_number`,
      [[...OWN_FLEET_OWNERSHIP_TYPES], today],
    );

  const tenantCounts = async (tenantId: string, today: string) => {
    const [row] = await dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM loads.loads l WHERE l.tenant_id = $1 AND l.status = ANY($2)) AS running,
         (SELECT count(*)::int FROM loads.loads l WHERE l.tenant_id = $1 AND l.status = $3) AS pods,
         (SELECT count(DISTINCT d.vehicle_id)::int FROM masters.vehicle_documents d
            JOIN masters.vehicles v ON v.id = d.vehicle_id AND v.deleted_at IS NULL
                 AND v.status IN ('active', 'under_maintenance')
           WHERE v.tenant_id = $1 AND d.deleted_at IS NULL AND d.document_type = ANY($4)
             AND d.expiry_date <= $5::date) AS blocked`,
      [
        tenantId,
        RUNNING_STATUSES,
        POD_PENDING_STATUS,
        [...VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY],
        today,
      ],
    );
    return {
      running: row.running as number,
      pods: row.pods as number,
      blocked: row.blocked as number,
    };
  };

  /** Active org users of a tenant with their effective permissions (role + direct grants). */
  const users = (tenantId: string): Promise<UserRow[]> =>
    dataSource.query(
      `SELECT u.id, r.name AS role,
              ARRAY(SELECT p.key FROM auth.role_permissions rp JOIN auth.permissions p ON p.id = rp.permission_id
                     WHERE rp.role_id = u.role_id
                    UNION
                    SELECT p.key FROM auth.user_permissions up JOIN auth.permissions p ON p.id = up.permission_id
                     WHERE up.user_id = u.id) AS permissions
         FROM auth.users u JOIN auth.roles r ON r.id = u.role_id AND r.scope = 'organization'
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
        ORDER BY u.created_at`,
      [tenantId],
    );

  const sentFor = async (type: string, tenantId: string, runDate: string, userId?: string) => {
    const [row] = await dataSource.query(
      `SELECT 1 FROM notifications.notifications WHERE tenant_id = $1 AND type = $2
          AND metadata->>'run_date' = $3 ${userId ? 'AND recipient_user_id = $4' : ''} LIMIT 1`,
      userId ? [tenantId, type, runDate, userId] : [tenantId, type, runDate],
    );
    return Boolean(row);
  };

  return {
    /** LS_N_0059 — per organisation, the longest-idle vehicle headlines; the rest are counted. */
    async runIdleWeekly(today: string) {
      const byTenant = new Map<string, (IdleRow & { idleDays: number })[]>();
      for (const row of await freeVehicles(today)) {
        const idleDays = daysBetween(row.last_trip_date, today);
        if (idleDays <= IDLE_DAYS) continue;
        byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) ?? []), { ...row, idleDays }]);
      }
      for (const [tenantId, rows] of byTenant) {
        const [top] = [...rows].sort((a, b) => b.idleDays - a.idleDays);
        const { perDay } = dailyFixedCost(top.fixed_cost_monthly, top.emi_amount);
        await triggers.enqueue('vehicle.idle_weekly', tenantId, {
          vehicleId: top.vehicle_id,
          vehicleNo: top.vehicle_no,
          idleDays: top.idleDays,
          lastTripDate: top.last_trip_date,
          fixedCostPerDay: perDay > 0 ? rupees(perDay) : null,
          idleCost: perDay > 0 ? rupees(perDay * top.idleDays) : null,
          otherIdleCount: rows.length - 1,
          runDate: today,
        });
      }
      return { idleOrganisations: byTenant.size };
    },

    /** LS_N_0060 — one brief per active org user, counts filtered to what they can see. */
    async runDailyBrief(today: string) {
      const organisations: { id: string; org_name: string }[] = await dataSource.query(
        `SELECT id, COALESCE(NULLIF(name, ''), NULLIF(registered_business_name, ''),
                             NULLIF(company_legal_name, ''), 'your organisation') AS org_name
           FROM auth.organizations WHERE status = 'active'`,
      );
      const free = await freeVehicles(today);
      let sent = 0;
      for (const org of organisations) {
        const counts = await tenantCounts(org.id, today);
        const emptyVehicles = free.filter((row) => row.tenant_id === org.id).length;
        for (const user of await users(org.id)) {
          const can = (permission: string) => user.permissions.includes(permission);
          const canApprove =
            can(MASTERS_APPROVE) || (can(CUSTOMERS_APPROVE) && user.role === ORG_ADMIN_ROLE);
          const podsPending = can(LOADS_DOCUMENTS_MANAGE) ? counts.pods : undefined;
          const approvalsPending = canApprove
            ? await countPendingApprovals(dataSource, org.id, user.permissions, user.role)
            : undefined;
          const vehiclesBlocked =
            can(COMPLIANCE_MANAGE) || can(DISPATCH_PLANNING_MANAGE) ? counts.blocked : undefined;
          const seesFleet = can(DISPATCH_PLANNING_MANAGE);
          // Static tokens (DAILY_BRIEF_STATIC) never count towards "needs you" or the skip rule.
          const needsAction = (podsPending ?? 0) + (approvalsPending ?? 0) + (vehiclesBlocked ?? 0);
          if (counts.running + needsAction + (seesFleet ? emptyVehicles : 0) === 0) continue;
          await triggers.enqueue('digest.daily_brief', org.id, {
            userId: user.id,
            orgName: org.org_name,
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
          sent += 1;
        }
      }
      return { dailyBriefs: sent };
    },

    /** Relevance checks — re-running a digest the same day never sends it twice. */
    idleWeeklyNotSent: async (tenantId: string, context: { runDate: string }) =>
      !(await sentFor('vehicle.idle_weekly', tenantId, context.runDate)),
    dailyBriefNotSent: async (tenantId: string, context: { userId: string; runDate: string }) =>
      !(await sentFor('digest.daily_brief', tenantId, context.runDate, context.userId)),
  };
}

/** Job name → runner, for the schedule worker. */
export function digestJobs(digests: ReturnType<typeof createDigests>) {
  return {
    [IDLE_WEEKLY_JOB]: (today: string) => digests.runIdleWeekly(today),
    [DAILY_BRIEF_JOB]: (today: string) => digests.runDailyBrief(today),
  };
}
