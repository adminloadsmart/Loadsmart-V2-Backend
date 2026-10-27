import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../jobs/queue-connection';
import { JobQueue } from '../../jobs/queue-registry';
import { COMPLIANCE_MANAGE } from '../../shared/constants/permissions';
import { addDays } from '../maintenance/calculations/dates';
import { DOCUMENT_TYPE_LABELS } from '../masters/vehicle/vehicle.constants';
import { VehicleDocumentTypeWithExpiry } from '../masters/vehicle/vehicle.type';
import {
  DriverLicenceExpiredContext,
  DriverLicenceExpiringContext,
  VehicleDocumentExpiredContext,
  VehicleDocumentExpiringContext,
} from './catalog/notification-catalog';
import { INDIA_TIME_ZONE, MS_PER_HOUR } from './notifications.constants';
import {
  DailyNotificationSweep,
  ExpiringVehicleDocument,
  NotificationScheduleJobData,
  VehicleDocumentAlertsDeps,
} from './notifications.interface';
import { indiaDate } from './utils/trip-time';

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
const LADDER_DAYS = [30, 15, 7, 3, 1];
const EXPIRED_REPEAT_DAYS = 7;
const ROLLUP_WINDOW_DAYS = 30;
const DRIVER_LADDER_DAYS = [30, 15, 7];
/** LS_N_0018 ladder on the expiry date: reminder at +2h (from the initial, via reminderAfterMs)
 *  and org-admin escalation at +4h. */
const DRIVER_ESCALATION_AFTER_MS = 4 * MS_PER_HOUR;

/** Registers the two cron schedules (idempotent — safe on every boot / every instance). */
export async function scheduleVehicleDocumentChecks(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(DAILY_JOB, '0 9 * * *', INDIA_TIME_ZONE, DAILY_JOB);
  await queue.upsertSchedule(WEEKLY_JOB, '0 9 * * 1', INDIA_TIME_ZONE, WEEKLY_JOB);
}

const label = (type: VehicleDocumentTypeWithExpiry) => DOCUMENT_TYPE_LABELS[type] ?? type;

export function createVehicleDocumentAlerts(deps: VehicleDocumentAlertsDeps) {
  const { scheduledAlertRepository, triggers, loadAlertRepository } = deps;

  const documentsExpiringWithinRollup = (today: string) =>
    scheduledAlertRepository.findVehicleDocumentsExpiringBetween(
      today,
      today,
      addDays(today, ROLLUP_WINDOW_DAYS),
    );

  const hasComplianceHolders = async (tenantId: string): Promise<boolean> =>
    (await deps.listUsersWithPermission(tenantId, COMPLIANCE_MANAGE)).length > 0;

  /** LS_N_0049 — the driver half of the daily check. */
  const runDriverLicences = async (today: string) => {
    const expiringLicences = await scheduledAlertRepository.findDriverLicencesExpiringIn(
      today,
      DRIVER_LADDER_DAYS,
    );
    for (const licence of expiringLicences) {
      const trips = await scheduledAlertRepository.countDriverUpcomingTrips(
        licence.tenantId,
        licence.driverId,
        today,
      );
      await triggers.enqueue('driver.licence_expiry', licence.tenantId, {
        tenantId: licence.tenantId,
        driverId: licence.driverId,
        driverName: licence.driverName,
        dlNo: licence.licenceNumber,
        expiryDate: licence.expiryDate,
        daysLeft: licence.daysLeft,
        tripCount: trips.upcoming,
        runDate: today,
      });
    }
    const expiredToday = await scheduledAlertRepository.findDriverLicencesExpiringIn(today, [0]);
    for (const licence of expiredToday) {
      const trips = await scheduledAlertRepository.countDriverUpcomingTrips(
        licence.tenantId,
        licence.driverId,
        today,
      );
      const includeOrgAdmins = trips.pickupToday || !(await hasComplianceHolders(licence.tenantId));
      const context = {
        tenantId: licence.tenantId,
        driverId: licence.driverId,
        driverName: licence.driverName,
        dlNo: licence.licenceNumber,
        expiryDate: licence.expiryDate,
        tripCount: trips.upcoming,
        runDate: today,
      };
      await triggers.enqueue('driver.licence_expired', licence.tenantId, {
        ...context,
        stage: 'initial',
        includeOrgAdmins,
      });
      // Org admins not yet in the loop → escalate to them at +4h if it's still unresolved.
      if (!includeOrgAdmins) {
        await triggers.enqueue(
          'driver.licence_expired',
          licence.tenantId,
          { ...context, stage: 'escalation', includeOrgAdmins: false },
          { delayMs: DRIVER_ESCALATION_AFTER_MS },
        );
      }
    }
    return { driversExpiring: expiringLicences.length, driversExpired: expiredToday.length };
  };

  /** One message per vehicle per day: the first (soonest-expiring) qualifying document. */
  const firstPerVehicle = (documents: ExpiringVehicleDocument[]) => {
    const documentByVehicle = new Map<string, ExpiringVehicleDocument>();
    for (const document of documents) {
      if (!documentByVehicle.has(document.vehicleId)) {
        documentByVehicle.set(document.vehicleId, document);
      }
    }
    return [...documentByVehicle.values()];
  };

  return {
    async runDaily(today: string) {
      const expiringDocuments = firstPerVehicle(
        await scheduledAlertRepository.findVehicleDocumentsExpiringOn(
          today,
          LADDER_DAYS.map((days) => addDays(today, days)),
        ),
      );
      const expiredDocuments = firstPerVehicle(
        await scheduledAlertRepository.findVehicleDocumentsExpiredOnRepeat(
          today,
          EXPIRED_REPEAT_DAYS,
        ),
      );
      const upcomingDocuments = await documentsExpiringWithinRollup(today);

      for (const document of expiringDocuments) {
        await triggers.enqueue('vehicle.document_expiry', document.tenantId, {
          vehicleId: document.vehicleId,
          vehicleNo: document.vehicleNo,
          docType: label(document.documentType),
          expiryDate: document.expiryDate,
          daysLeft: document.daysLeft,
          plannedTripCount: await scheduledAlertRepository.countPlannedVehicleTrips(
            document.tenantId,
            document.vehicleId,
            { fromDate: document.expiryDate, excludeFromDate: true },
          ),
          otherCount: upcomingDocuments.filter(
            (upcoming) => upcoming.tenantId === document.tenantId && upcoming.id !== document.id,
          ).length,
          runDate: today,
        });
      }
      for (const document of expiredDocuments) {
        await triggers.enqueue('vehicle.compliance_expired', document.tenantId, {
          vehicleId: document.vehicleId,
          vehicleNo: document.vehicleNo,
          docType: label(document.documentType),
          expiryDate: document.expiryDate,
          affectedTripCount: await scheduledAlertRepository.countPlannedVehicleTrips(
            document.tenantId,
            document.vehicleId,
            { fromDate: today },
          ),
          nextAffectedTrip: await loadAlertRepository.findNextPlannedTrip(
            document.tenantId,
            document.vehicleId,
            today,
          ),
          runDate: today,
        });
      }
      return {
        expiring: expiringDocuments.length,
        expired: expiredDocuments.length,
        ...(await runDriverLicences(today)),
      };
    },

    async runWeeklyRollup(today: string) {
      const upcomingDocuments = await documentsExpiringWithinRollup(today);
      const documentsByTenant = new Map<string, ExpiringVehicleDocument[]>();
      for (const document of upcomingDocuments) {
        documentsByTenant.set(document.tenantId, [
          ...(documentsByTenant.get(document.tenantId) ?? []),
          document,
        ]);
      }
      for (const [tenantId, documents] of documentsByTenant) {
        await triggers.enqueue('vehicle.documents_expiring_rollup', tenantId, {
          docCount: documents.length,
          docList: documents
            .map(
              (document) =>
                `${label(document.documentType)} on ${document.vehicleNo} — ${document.expiryDate}`,
            )
            .join('; '),
          runDate: today,
        });
      }
      return { organisations: documentsByTenant.size };
    },

    /** Relevance check for LS_N_0047/0048: never twice for the same vehicle on the same day,
     *  even if a check is re-run after its first job already completed. */
    notAlreadySentToday:
      (type: 'vehicle.document_expiry' | 'vehicle.compliance_expired') =>
      async (
        tenantId: string,
        context: VehicleDocumentExpiringContext | VehicleDocumentExpiredContext,
      ) =>
        !(await scheduledAlertRepository.hasSentNotification(tenantId, type, {
          vehicle_id: context.vehicleId,
          run_date: context.runDate,
        })),

    /** LS_N_0049 (expiring): one per driver per day, even if the check is re-run. */
    driverExpiringNotSentToday: async (tenantId: string, context: DriverLicenceExpiringContext) =>
      !(await scheduledAlertRepository.hasSentNotification(tenantId, 'driver.licence_expiry', {
        driver_id: context.driverId,
        run_date: context.runDate,
      })),

    /** LS_N_0049 (expired): each ladder step at most once, and the reminder/escalation only while
     *  the licence is still expired — a renewal (expiry moved past today) cancels them. */
    driverExpiredStillRelevant: async (
      tenantId: string,
      context: DriverLicenceExpiredContext & { isReminder?: boolean },
    ) => {
      const stillExpired = await scheduledAlertRepository.hasExpiredDriverLicence(
        tenantId,
        context.driverId,
        context.runDate,
      );
      if (!stillExpired) return false;
      return !(await scheduledAlertRepository.hasSentNotification(
        tenantId,
        'driver.licence_expired',
        {
          driver_id: context.driverId,
          run_date: context.runDate,
          ladder_step: context.isReminder ? 'reminder' : context.stage,
        },
      ));
    },
  };
}

/** Worker for the 'notification-schedules' queue. Job data may carry `today` (YYYY-MM-DD) to run
 *  a check for a specific date; otherwise it's today in India time. */
export function createNotificationScheduleWorker(
  alerts: ReturnType<typeof createVehicleDocumentAlerts>,
  // LS_N_0056/0057 — the service-distance sweep shares the daily 9:00 tick.
  serviceAlerts?: DailyNotificationSweep,
  // LS_N_0059/0060 — digest jobs on the same queue, by job name (see digests.ts).
  otherJobs: Record<string, (today: string) => Promise<unknown>> = {},
): Worker {
  return new Worker<NotificationScheduleJobData>(
    NOTIFICATION_SCHEDULES_QUEUE,
    async (job: Job<NotificationScheduleJobData>) => {
      const today = job.data?.today ?? indiaDate();
      if (job.name === DAILY_JOB) {
        return { ...(await alerts.runDaily(today)), ...(await serviceAlerts?.runDaily(today)) };
      }
      if (job.name === WEEKLY_JOB) return alerts.runWeeklyRollup(today);
      return otherJobs[job.name]?.(today);
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
}
