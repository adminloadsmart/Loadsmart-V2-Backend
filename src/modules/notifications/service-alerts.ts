import { DataSource } from 'typeorm';
import {
  DEFAULT_AVG_DAILY_KM,
  DEFAULT_SERVICE_INTERVAL_KM,
} from '../maintenance/maintenance.constants';
import {
  MAINTAINED_VEHICLE_STATUSES,
  OWN_FLEET_OWNERSHIP_TYPES,
} from '../maintenance/maintenance.types';
import { MAINTENANCE_MANAGE } from '../../shared/constants/permissions';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { NotificationTriggers } from './notification-triggers';

/**
 * LS_N_0056 "service due soon" / LS_N_0057 "service overdue" — run inside the daily 9:00 IST
 * check (see vehicle-document-alerts.ts's schedule worker). Distance clock only, as the sheet
 * asks: due at last-service odometer + the vehicle's interval (DEFAULT_SERVICE_INTERVAL_KM when
 * it has no policy of its own), the same reading maintenance's service-due queue uses. There is
 * no charge-cycle data, so EVs follow the same odometer rule.
 *
 * Skipped: vehicles with no service record (nothing to measure from) and trucks already in the
 * workshop (someone is on it). A logged service moves the last-service odometer, which starts a
 * new cycle — keyed by its due-at km — so both alerts reset on their own.
 */
const DUE_SOON_SHARE = 0.1; // first alert with 10% of the interval left…
const DUE_SOON_HALF_SHARE = 0.05; // …and again at half that distance
const OVERDUE_REPEAT_DAYS = 7;
const OVERDUE_ESCALATE_DAYS = 14;
const SERVICE_TYPE = 'preventive';

interface VehicleRow {
  tenant_id: string;
  vehicle_id: string;
  vehicle_no: string;
  odometer_km: number;
  last_service_odometer_km: number;
  last_service_date: string | null;
  interval_km: number | null;
}

const rupees = (value: number) =>
  `₹${Math.round(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function createServiceAlerts(dataSource: DataSource, triggers: NotificationTriggers) {
  const vehicles = (): Promise<VehicleRow[]> =>
    dataSource.query(
      `SELECT v.tenant_id, v.id AS vehicle_id, v.registration_number AS vehicle_no,
              u.odometer_km, u.last_service_odometer_km, u.last_service_date::text AS last_service_date,
              u.service_interval_km AS interval_km
         FROM masters.vehicles v
         JOIN masters.vehicle_service_usage u ON u.vehicle_id = v.id AND u.deleted_at IS NULL
        WHERE v.deleted_at IS NULL AND v.ownership_type = ANY($1) AND v.status = ANY($2)
          AND u.odometer_km IS NOT NULL AND u.last_service_odometer_km IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM maintenance.maintenance_jobs j
                           WHERE j.vehicle_id = v.id AND j.status = 'open')
        ORDER BY v.registration_number`,
      [[...OWN_FLEET_OWNERSHIP_TYPES], [...MAINTAINED_VEHICLE_STATUSES]],
    );

  /** km a day since the last service; DEFAULT_AVG_DAILY_KM without a dated service or distance —
   *  the same fallback maintenance's tyre forecast uses. */
  const dailyAverageKm = (row: VehicleRow, today: string): number => {
    if (!row.last_service_date) return DEFAULT_AVG_DAILY_KM;
    const days = (Date.parse(today) - Date.parse(row.last_service_date)) / 86_400_000;
    const km = row.odometer_km - row.last_service_odometer_km;
    return days > 0 && km > 0 ? km / days : DEFAULT_AVG_DAILY_KM;
  };

  const plannedTrips = async (tenantId: string, vehicleId: string, from: string, days: number) => {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n FROM loads.loads l
         JOIN loads.requisitions r ON r.id = l.requisition_id
        WHERE l.tenant_id = $1 AND l.vehicle_id = $2 AND l.status IN ('created', 'assigned')
          AND r.pickup_date BETWEEN $3::date AND $3::date + $4::int`,
      [tenantId, vehicleId, from, days],
    );
    return (row?.n as number) ?? 0;
  };

  /** Org-wide average cost of closed service and breakdown jobs over the last 12 months. */
  const averageCosts = async (tenantId: string) => {
    const [row] = await dataSource.query(
      `SELECT avg(total_cost) FILTER (WHERE job_type = 'service') AS service,
              avg(total_cost) FILTER (WHERE job_type = 'breakdown') AS breakdown
         FROM maintenance.maintenance_jobs
        WHERE tenant_id = $1 AND status = 'closed' AND total_cost IS NOT NULL
          AND closed_at >= now() - interval '12 months'`,
      [tenantId],
    );
    return {
      serviceCost: row?.service != null ? rupees(Number(row.service)) : null,
      breakdownCost: row?.breakdown != null ? rupees(Number(row.breakdown)) : null,
    };
  };

  const sentRunDates = async (tenantId: string, vehicleId: string, dueAtKm: number) =>
    (
      (await dataSource.query(
        `SELECT DISTINCT metadata->>'run_date' AS run_date FROM notifications.notifications
          WHERE tenant_id = $1 AND type = 'vehicle.service_overdue'
            AND metadata->>'vehicle_id' = $2 AND metadata->>'service_due_km' = $3
          ORDER BY 1`,
        [tenantId, vehicleId, String(dueAtKm)],
      )) as { run_date: string }[]
    ).map((row) => row.run_date);

  const dueSoonStagesSent = async (tenantId: string, vehicleId: string, dueAtKm: number) =>
    (
      (await dataSource.query(
        `SELECT DISTINCT metadata->>'stage' AS stage FROM notifications.notifications
          WHERE tenant_id = $1 AND type = 'vehicle.service_due_soon'
            AND metadata->>'vehicle_id' = $2 AND metadata->>'service_due_km' = $3`,
        [tenantId, vehicleId, String(dueAtKm)],
      )) as { stage: string }[]
    ).map((row) => row.stage);

  /** Anyone other than an org admin holding maintenance.manage (org admins hold it by role). */
  const hasMaintenanceHolders = async (tenantId: string): Promise<boolean> => {
    const [row] = await dataSource.query(
      `SELECT 1 FROM auth.users u JOIN auth.roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND r.name <> $3 AND (
          EXISTS (SELECT 1 FROM auth.role_permissions rp JOIN auth.permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = u.role_id AND p.key = $2)
          OR EXISTS (SELECT 1 FROM auth.user_permissions up JOIN auth.permissions p ON p.id = up.permission_id
                      WHERE up.user_id = u.id AND p.key = $2)) LIMIT 1`,
      [tenantId, MAINTENANCE_MANAGE, ORG_ADMIN_ROLE],
    );
    return Boolean(row);
  };

  const daysBetween = (from: string, to: string) =>
    Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

  return {
    async runDaily(today: string) {
      let dueSoon = 0;
      let overdue = 0;
      for (const row of await vehicles()) {
        const intervalKm = row.interval_km ?? DEFAULT_SERVICE_INTERVAL_KM;
        const dueAtKm = row.last_service_odometer_km + intervalKm;
        const kmLeft = dueAtKm - row.odometer_km;

        if (kmLeft > 0) {
          // LS_N_0056 — once inside 10% of the interval, again inside 5%. Jumping straight into
          // the 5% band (a big odometer update) sends just that one.
          const stage =
            kmLeft <= intervalKm * DUE_SOON_HALF_SHARE
              ? 'half'
              : kmLeft <= intervalKm * DUE_SOON_SHARE
                ? 'threshold'
                : null;
          if (!stage) continue;
          const sent = await dueSoonStagesSent(row.tenant_id, row.vehicle_id, dueAtKm);
          if (sent.includes(stage) || (stage === 'threshold' && sent.includes('half'))) continue;
          const dailyAvg = dailyAverageKm(row, today);
          const daysLeft = Math.max(1, Math.ceil(kmLeft / dailyAvg));
          await triggers.enqueue('vehicle.service_due_soon', row.tenant_id, {
            vehicleId: row.vehicle_id,
            vehicleNo: row.vehicle_no,
            kmRemaining: kmLeft,
            serviceType: SERVICE_TYPE,
            serviceDueKm: dueAtKm,
            dailyAvgKm: Math.round(dailyAvg),
            daysRemaining: daysLeft,
            plannedTripCount: await plannedTrips(row.tenant_id, row.vehicle_id, today, daysLeft),
            stage,
            runDate: today,
          });
          dueSoon += 1;
          continue;
        }

        // LS_N_0057 — past the due km: weekly from the first alert of this service cycle; the
        // org admin joins once it has been overdue 2 weeks (or straight away if nobody holds
        // maintenance.manage, so it never goes unheard).
        if (kmLeft === 0) continue; // at the limit, not yet past it
        const runDates = await sentRunDates(row.tenant_id, row.vehicle_id, dueAtKm);
        const last = runDates[runDates.length - 1];
        if (last && daysBetween(last, today) < OVERDUE_REPEAT_DAYS) continue;
        const first = runDates[0] ?? today;
        await triggers.enqueue('vehicle.service_overdue', row.tenant_id, {
          vehicleId: row.vehicle_id,
          vehicleNo: row.vehicle_no,
          kmOverdue: -kmLeft,
          serviceType: SERVICE_TYPE,
          serviceDueKm: dueAtKm,
          currentOdometer: row.odometer_km,
          ...(await averageCosts(row.tenant_id)),
          escalated:
            daysBetween(first, today) >= OVERDUE_ESCALATE_DAYS ||
            !(await hasMaintenanceHolders(row.tenant_id)),
          runDate: today,
        });
        overdue += 1;
      }
      return { serviceDueSoon: dueSoon, serviceOverdue: overdue };
    },

    /** Relevance checks — a re-run of the same day's check never sends a stage/run twice. */
    dueSoonNotAlreadySent: async (
      tenantId: string,
      context: { vehicleId: string; serviceDueKm: number; stage: string },
    ) =>
      !(await dueSoonStagesSent(tenantId, context.vehicleId, context.serviceDueKm)).includes(
        context.stage,
      ),
    overdueNotAlreadySentToday: async (
      tenantId: string,
      context: { vehicleId: string; serviceDueKm: number; runDate: string },
    ) =>
      !(await sentRunDates(tenantId, context.vehicleId, context.serviceDueKm)).includes(
        context.runDate,
      ),
  };
}
