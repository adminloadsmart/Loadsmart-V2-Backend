import { DataSource } from 'typeorm';
import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../jobs/queue-connection';
import { JobQueue } from '../../jobs/queue-registry';
import { DOCUMENT_TYPE_LABELS } from '../masters/vehicle/vehicle.constants';
import {
  VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY,
  VehicleDocumentTypeWithExpiry,
} from '../masters/vehicle/vehicle.type';
import { NotificationTriggers } from './notification-triggers';

/**
 * LS_N_0047 "vehicle document expiring" / LS_N_0048 "vehicle document expired" — replaces the old
 * masters per-document delayed jobs with one daily sweep of the stored vehicle-document expiry
 * dates (there is no ULIP integration; the dates come from uploaded/Vahan-verified papers), plus
 * a weekly organisation roll-up. Both run on the 'notification-schedules' queue via BullMQ job
 * schedulers, so they fire once per tick however many API instances are running.
 *
 * "Today" is the India date. A document is expired from its expiry date onward, matching
 * masters' resolveDocumentStatus.
 */
export const NOTIFICATION_SCHEDULES_QUEUE = 'notification-schedules';
const DAILY_JOB = 'vehicle-documents-daily';
const WEEKLY_JOB = 'vehicle-documents-weekly-rollup';
const TIMEZONE = 'Asia/Kolkata';
const LADDER_DAYS = [30, 15, 7, 3, 1];
const EXPIRED_REPEAT_DAYS = 7;
const ROLLUP_WINDOW_DAYS = 30;
const DRIVER_LADDER_DAYS = [30, 15, 7];
const HOUR_MS = 60 * 60 * 1000;
/** LS_N_0018 ladder on the expiry date: reminder at +2h (from the initial, via reminderAfterMs)
 *  and org-admin escalation at +4h. */
const DRIVER_ESCALATION_AFTER_MS = 4 * HOUR_MS;

/** Registers the two cron schedules (idempotent — safe on every boot / every instance). */
export async function scheduleVehicleDocumentChecks(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(DAILY_JOB, '0 9 * * *', TIMEZONE, DAILY_JOB);
  await queue.upsertSchedule(WEEKLY_JOB, '0 9 * * 1', TIMEZONE, WEEKLY_JOB);
}

export function indiaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(at); // YYYY-MM-DD
}

interface DocumentRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  document_type: VehicleDocumentTypeWithExpiry;
  expiry_date: string;
  days_left: number;
  vehicle_no: string;
}

const label = (type: VehicleDocumentTypeWithExpiry) => DOCUMENT_TYPE_LABELS[type] ?? type;

export function createVehicleDocumentAlerts(
  dataSource: DataSource,
  triggers: NotificationTriggers,
) {
  const documents = (today: string, where: string): Promise<DocumentRow[]> =>
    dataSource.query(
      `SELECT d.id, d.tenant_id, d.vehicle_id, d.document_type, d.expiry_date::text AS expiry_date,
              (d.expiry_date - $1::date) AS days_left, v.registration_number AS vehicle_no
         FROM masters.vehicle_documents d
         JOIN masters.vehicles v ON v.id = d.vehicle_id AND v.deleted_at IS NULL
        WHERE d.deleted_at IS NULL AND d.expiry_date IS NOT NULL
          AND d.document_type = ANY($2) AND ${where}
        ORDER BY d.expiry_date ASC, d.id ASC`,
      [today, [...VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY]],
    );

  /** Planned (not yet started) trips on a vehicle whose pickup is on/after `fromDate`
   *  (`strictlyAfter` → after). */
  const plannedTrips = async (
    tenantId: string,
    vehicleId: string,
    fromDate: string,
    strictlyAfter: boolean,
  ): Promise<number> => {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n FROM loads.loads l
         JOIN loads.requisitions r ON r.id = l.requisition_id
        WHERE l.tenant_id = $1 AND l.vehicle_id = $2 AND l.status IN ('created', 'assigned')
          AND r.pickup_date ${strictlyAfter ? '>' : '>='} $3::date`,
      [tenantId, vehicleId, fromDate],
    );
    return row?.n ?? 0;
  };

  /** Drivers whose licence is exactly `daysLeft` days from `today` (0 = expires today). */
  const drivers = (
    today: string,
    daysLeft: number[],
  ): Promise<
    {
      id: string;
      tenant_id: string;
      full_name: string;
      license_number: string | null;
      expiry_date: string;
      days_left: number;
    }[]
  > =>
    dataSource.query(
      `SELECT id, tenant_id, full_name, license_number, license_expiry::text AS expiry_date,
              (license_expiry - $1::date) AS days_left
         FROM masters.drivers
        WHERE deleted_at IS NULL AND license_expiry IS NOT NULL
          AND status NOT IN ('inactive', 'rejected')
          AND (license_expiry - $1::date) = ANY($2)`,
      [today, daysLeft],
    );

  /** Upcoming (not yet started) trips a driver is rostered on, from `today`. */
  const driverTrips = async (tenantId: string, driverId: string, today: string) => {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE r.pickup_date = $3::date)::int AS today
         FROM loads.loads l JOIN loads.requisitions r ON r.id = l.requisition_id
        WHERE l.tenant_id = $1 AND l.driver_id = $2 AND l.status IN ('created', 'assigned')
          AND r.pickup_date >= $3::date`,
      [tenantId, driverId, today],
    );
    return { upcoming: (row?.n as number) ?? 0, pickupToday: ((row?.today as number) ?? 0) > 0 };
  };

  const hasComplianceHolders = async (tenantId: string): Promise<boolean> => {
    const [row] = await dataSource.query(
      `SELECT 1 FROM auth.users u WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND (
          EXISTS (SELECT 1 FROM auth.role_permissions rp JOIN auth.permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = u.role_id AND p.key = 'compliance.manage')
          OR EXISTS (SELECT 1 FROM auth.user_permissions up JOIN auth.permissions p ON p.id = up.permission_id
                      WHERE up.user_id = u.id AND p.key = 'compliance.manage')) LIMIT 1`,
      [tenantId],
    );
    return Boolean(row);
  };

  /** LS_N_0049 — the driver half of the daily check. */
  const runDriverLicences = async (today: string) => {
    const expiring = await drivers(today, DRIVER_LADDER_DAYS);
    for (const driver of expiring) {
      await triggers.enqueue('driver.licence_expiry', driver.tenant_id, {
        driverId: driver.id,
        driverName: driver.full_name,
        dlNo: driver.license_number,
        expiryDate: driver.expiry_date,
        daysLeft: Number(driver.days_left),
        tripCount: (await driverTrips(driver.tenant_id, driver.id, today)).upcoming,
        runDate: today,
      });
    }
    const expiredToday = await drivers(today, [0]);
    for (const driver of expiredToday) {
      const trips = await driverTrips(driver.tenant_id, driver.id, today);
      const includeOrgAdmins = trips.pickupToday || !(await hasComplianceHolders(driver.tenant_id));
      const context = {
        driverId: driver.id,
        driverName: driver.full_name,
        dlNo: driver.license_number,
        expiryDate: driver.expiry_date,
        tripCount: trips.upcoming,
        runDate: today,
      };
      await triggers.enqueue('driver.licence_expired', driver.tenant_id, {
        ...context,
        stage: 'initial',
        includeOrgAdmins,
      });
      // Org admins not yet in the loop → escalate to them at +4h if it's still unresolved.
      if (!includeOrgAdmins) {
        await triggers.enqueue(
          'driver.licence_expired',
          driver.tenant_id,
          { ...context, stage: 'escalation', includeOrgAdmins: false },
          { delayMs: DRIVER_ESCALATION_AFTER_MS },
        );
      }
    }
    return { driversExpiring: expiring.length, driversExpired: expiredToday.length };
  };

  /** One message per vehicle per day: the first (soonest-expiring) qualifying document. */
  const firstPerVehicle = (rows: DocumentRow[]) => {
    const byVehicle = new Map<string, DocumentRow>();
    for (const row of rows) if (!byVehicle.has(row.vehicle_id)) byVehicle.set(row.vehicle_id, row);
    return [...byVehicle.values()];
  };

  return {
    async runDaily(today: string) {
      const expiringRows = firstPerVehicle(
        await documents(today, `(d.expiry_date - $1::date) IN (${LADDER_DAYS.join(',')})`),
      );
      const expiredRows = firstPerVehicle(
        await documents(
          today,
          `d.expiry_date <= $1::date AND ($1::date - d.expiry_date) % ${EXPIRED_REPEAT_DAYS} = 0`,
        ),
      );
      const upcoming = await documents(
        today,
        `d.expiry_date BETWEEN $1::date AND $1::date + ${ROLLUP_WINDOW_DAYS}`,
      );

      for (const row of expiringRows) {
        await triggers.enqueue('vehicle.document_expiry', row.tenant_id, {
          vehicleId: row.vehicle_id,
          vehicleNo: row.vehicle_no,
          docType: label(row.document_type),
          expiryDate: row.expiry_date,
          daysLeft: Number(row.days_left),
          plannedTripCount: await plannedTrips(
            row.tenant_id,
            row.vehicle_id,
            row.expiry_date,
            true,
          ),
          otherCount: upcoming.filter((d) => d.tenant_id === row.tenant_id && d.id !== row.id)
            .length,
          runDate: today,
        });
      }
      for (const row of expiredRows) {
        await triggers.enqueue('vehicle.compliance_expired', row.tenant_id, {
          vehicleId: row.vehicle_id,
          vehicleNo: row.vehicle_no,
          docType: label(row.document_type),
          expiryDate: row.expiry_date,
          affectedTripCount: await plannedTrips(row.tenant_id, row.vehicle_id, today, false),
          runDate: today,
        });
      }
      return {
        expiring: expiringRows.length,
        expired: expiredRows.length,
        ...(await runDriverLicences(today)),
      };
    },

    async runWeeklyRollup(today: string): Promise<{ organisations: number }> {
      const upcoming = await documents(
        today,
        `d.expiry_date BETWEEN $1::date AND $1::date + ${ROLLUP_WINDOW_DAYS}`,
      );
      const byTenant = new Map<string, DocumentRow[]>();
      for (const row of upcoming)
        byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) ?? []), row]);
      for (const [tenantId, rows] of byTenant) {
        await triggers.enqueue('vehicle.documents_expiring_rollup', tenantId, {
          docCount: rows.length,
          docList: rows
            .map((row) => `${label(row.document_type)} on ${row.vehicle_no} — ${row.expiry_date}`)
            .join('; '),
          runDate: today,
        });
      }
      return { organisations: byTenant.size };
    },

    /** Relevance check for LS_N_0047/0048: never twice for the same vehicle on the same day,
     *  even if a check is re-run after its first job already completed. */
    notAlreadySentToday:
      (type: string) =>
      async (tenantId: string, context: { vehicleId: string; runDate: string }) => {
        const [row] = await dataSource.query(
          `SELECT 1 FROM notifications.notifications WHERE tenant_id = $1 AND type = $2
              AND metadata->>'vehicle_id' = $3 AND metadata->>'run_date' = $4 LIMIT 1`,
          [tenantId, type, context.vehicleId, context.runDate],
        );
        return !row;
      },

    /** LS_N_0049 (expiring): one per driver per day, even if the check is re-run. */
    driverExpiringNotSentToday: async (
      tenantId: string,
      context: { driverId: string; runDate: string },
    ) => {
      const [row] = await dataSource.query(
        `SELECT 1 FROM notifications.notifications WHERE tenant_id = $1
            AND type = 'driver.licence_expiry' AND metadata->>'driver_id' = $2
            AND metadata->>'run_date' = $3 LIMIT 1`,
        [tenantId, context.driverId, context.runDate],
      );
      return !row;
    },

    /** LS_N_0049 (expired): each ladder step at most once, and the reminder/escalation only while
     *  the licence is still expired — a renewal (expiry moved past today) cancels them. */
    driverExpiredStillRelevant: async (
      tenantId: string,
      context: { driverId: string; runDate: string; stage: string; isReminder?: boolean },
    ) => {
      const [driver] = await dataSource.query(
        `SELECT 1 FROM masters.drivers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            AND license_expiry IS NOT NULL AND license_expiry <= $3::date`,
        [context.driverId, tenantId, context.runDate],
      );
      if (!driver) return false;
      const step = context.isReminder ? 'reminder' : context.stage;
      const [sent] = await dataSource.query(
        `SELECT 1 FROM notifications.notifications WHERE tenant_id = $1
            AND type = 'driver.licence_expired' AND metadata->>'driver_id' = $2
            AND metadata->>'run_date' = $3 AND metadata->>'ladder_step' = $4 LIMIT 1`,
        [tenantId, context.driverId, context.runDate, step],
      );
      return !sent;
    },
  };
}

/** Worker for the 'notification-schedules' queue. Job data may carry `today` (YYYY-MM-DD) to run
 *  a check for a specific date; otherwise it's today in India time. */
export function createNotificationScheduleWorker(
  alerts: ReturnType<typeof createVehicleDocumentAlerts>,
  // LS_N_0056/0057 — the service-distance sweep shares the daily 9:00 tick.
  serviceAlerts?: { runDaily(today: string): Promise<Record<string, number>> },
): Worker {
  return new Worker<{ today?: string }>(
    NOTIFICATION_SCHEDULES_QUEUE,
    async (job: Job<{ today?: string }>) => {
      const today = job.data?.today ?? indiaDate();
      if (job.name === DAILY_JOB) {
        return { ...(await alerts.runDaily(today)), ...(await serviceAlerts?.runDaily(today)) };
      }
      if (job.name === WEEKLY_JOB) return alerts.runWeeklyRollup(today);
      return undefined;
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
}
