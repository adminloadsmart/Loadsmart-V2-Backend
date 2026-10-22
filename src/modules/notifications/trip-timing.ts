import { JobQueue } from '../../jobs/queue-registry';
import { NotificationTriggers } from './notification-triggers';
import { DetentionCandidate, LoadAlertRepository } from './load-alert.repository';
import {
  CLAIM_REMINDER_DAYS_BEFORE,
  DETENTION_ALERT_MAX_HOURS,
  DETENTION_REPEAT_HOURS,
  INDIA_TIME_ZONE,
  MS_PER_MINUTE,
  NOT_REPORTED_ALERT_MINUTES,
  POD_PENDING_ALERT_HOURS,
  TRIP_COMPLETED_FALLBACK_MS,
  TRIP_TIMING_GRACE_MINUTES,
} from './notifications.constants';

export const TRIP_TIMING_JOB = 'trip-timing-check';
/** Every 5 minutes — LS_N_0021's 60 min / 3 h / 5 h steps and LS_N_0023/0032's detention steps go
 *  out within 5 minutes of when they're due. */
const TRIP_TIMING_CRON = '*/5 * * * *';

export async function scheduleTripTimingChecks(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(TRIP_TIMING_JOB, TRIP_TIMING_CRON, INDIA_TIME_ZONE, TRIP_TIMING_JOB);
}

/**
 * Time-driven trip alerts, swept on the 'notification-schedules' queue: LS_N_0021 (vehicle not
 * reported — still "assigned" after its reporting time), LS_N_0023 (detention — still at the
 * loading point past the company's free hours) and LS_N_0032 (detention — still at the delivery
 * point past the customer's or company's free hours); see LoadAlertRepository's
 * find*DetentionCandidates for when a vehicle counts as still there — plus LS_N_0034's reminder
 * before a shortage/damage claim window closes, and LS_N_0039 (POD still pending 24 / 48 / 72 h
 * after the vehicle reached the delivery point or its E-POD was rejected). Each run queues the step
 * that's due; a step only counts as due for TRIP_TIMING_GRACE_MINUTES, so a backlog never sends stale alerts, and the trigger worker's
 * resolvers (load-alerts.ts) drop a step that already went out or no longer applies.
 */
export function createTripTimingChecks(
  loadAlertRepository: LoadAlertRepository,
  triggers: NotificationTriggers,
) {
  const firstStepMinutes = NOT_REPORTED_ALERT_MINUTES[0];
  const lastStepMinutes = NOT_REPORTED_ALERT_MINUTES[NOT_REPORTED_ALERT_MINUTES.length - 1];
  const detentionRepeatMinutes = DETENTION_REPEAT_HOURS * 60;

  return {
    async run(now: Date = new Date()): Promise<{
      notReported: number;
      detention: number;
      unloadingDetention: number;
      claimReminders: number;
      podPending: number;
    }> {
      const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * MS_PER_MINUTE);

      let notReported = 0;
      const awaitingVehicle = await loadAlertRepository.findAssignedLoadsDueBetween(
        minutesAgo(lastStepMinutes + TRIP_TIMING_GRACE_MINUTES),
        minutesAgo(firstStepMinutes),
      );
      for (const load of awaitingVehicle) {
        const lateMinutes = (now.getTime() - load.reportingAt.getTime()) / MS_PER_MINUTE;
        const step = NOT_REPORTED_ALERT_MINUTES.findIndex(
          (minutes) => lateMinutes >= minutes && lateMinutes < minutes + TRIP_TIMING_GRACE_MINUTES,
        );
        if (step < 0) continue;
        await triggers.enqueue('load.vehicle_not_reported', load.tenantId, {
          loadId: load.loadId,
          reportingAt: load.reportingAt.toISOString(),
          step,
        });
        notReported++;
      }

      // Detention: due at the free-time boundary, then every DETENTION_REPEAT_HOURS, up to
      // DETENTION_ALERT_MAX_HOURS — the step that's due now, if any.
      const dueStepOf = (load: DetentionCandidate): number | null => {
        const overMinutes =
          (now.getTime() - load.arrivedAt.getTime()) / MS_PER_MINUTE - load.freeHours * 60;
        if (overMinutes < 0 || overMinutes >= DETENTION_ALERT_MAX_HOURS * 60) return null;
        const step = Math.floor(overMinutes / detentionRepeatMinutes);
        return overMinutes - step * detentionRepeatMinutes < TRIP_TIMING_GRACE_MINUTES
          ? step
          : null;
      };

      let detention = 0;
      for (const load of await loadAlertRepository.findLoadingDetentionCandidates(now)) {
        const step = dueStepOf(load);
        if (step === null) continue;
        await triggers.enqueue('load.detention_at_loading', load.tenantId, {
          loadId: load.loadId,
          arrivedAt: load.arrivedAt.toISOString(),
          step,
        });
        detention++;
      }

      let unloadingDetention = 0;
      const atDestination = await loadAlertRepository.findUnloadingDetentionCandidates(
        now,
        new Date(now.getTime() - TRIP_COMPLETED_FALLBACK_MS),
      );
      for (const load of atDestination) {
        const step = dueStepOf(load);
        if (step === null) continue;
        await triggers.enqueue('load.detention_at_unloading', load.tenantId, {
          loadId: load.loadId,
          arrivedAt: load.arrivedAt.toISOString(),
          step,
        });
        unloadingDetention++;
      }
      // LS_N_0034 — CLAIM_REMINDER_DAYS_BEFORE days before a shortage/damage claim window closes.
      let claimReminders = 0;
      const claimsClosing = await loadAlertRepository.findClaimReminderDueBetween(
        minutesAgo(TRIP_TIMING_GRACE_MINUTES),
        now,
        CLAIM_REMINDER_DAYS_BEFORE,
      );
      for (const load of claimsClosing) {
        await triggers.enqueue('load.shortage_recorded', load.tenantId, {
          loadId: load.loadId,
          reminder: true,
        });
        claimReminders++;
      }

      // LS_N_0039 — the step that's due now, if any, for a load still waiting on its POD.
      let podPending = 0;
      const lastPodStepHours = POD_PENDING_ALERT_HOURS[POD_PENDING_ALERT_HOURS.length - 1];
      const awaitingPod = await loadAlertRepository.findPodPendingBetween(
        minutesAgo(lastPodStepHours * 60 + TRIP_TIMING_GRACE_MINUTES),
        minutesAgo(POD_PENDING_ALERT_HOURS[0] * 60),
      );
      for (const load of awaitingPod) {
        const waitedMinutes = (now.getTime() - load.since.getTime()) / MS_PER_MINUTE;
        const step = POD_PENDING_ALERT_HOURS.findIndex(
          (hours) =>
            waitedMinutes >= hours * 60 && waitedMinutes < hours * 60 + TRIP_TIMING_GRACE_MINUTES,
        );
        if (step < 0) continue;
        await triggers.enqueue('load.pod_pending', load.tenantId, {
          loadId: load.loadId,
          since: load.since.toISOString(),
          step,
        });
        podPending++;
      }
      return { notReported, detention, unloadingDetention, claimReminders, podPending };
    },
  };
}
