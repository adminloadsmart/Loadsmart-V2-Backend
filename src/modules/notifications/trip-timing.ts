import { JobQueue } from '../../jobs/queue-registry';
import { NotificationTriggers } from './notification-triggers';
import { LoadAlertRepository } from './load-alert.repository';
import {
  DETENTION_ALERT_MAX_HOURS,
  DETENTION_REPEAT_HOURS,
  FREE_LOADING_HOURS,
  INDIA_TIME_ZONE,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  NOT_REPORTED_ALERT_MINUTES,
  TRIP_TIMING_GRACE_MINUTES,
} from './notifications.constants';

export const TRIP_TIMING_JOB = 'trip-timing-check';
/** Every 5 minutes — LS_N_0021's 60 min / 3 h / 5 h steps and LS_N_0023's detention steps go out
 *  within 5 minutes of when they're due. */
const TRIP_TIMING_CRON = '*/5 * * * *';

export async function scheduleTripTimingChecks(queue: JobQueue): Promise<void> {
  await queue.upsertSchedule(TRIP_TIMING_JOB, TRIP_TIMING_CRON, INDIA_TIME_ZONE, TRIP_TIMING_JOB);
}

/**
 * Time-driven trip alerts, swept on the 'notification-schedules' queue: LS_N_0021 (vehicle not
 * reported — still "assigned" after its reporting time) and LS_N_0023 (detention — still "At
 * plant" past the free hours). Each run queues the step that's due; a step only counts as due for
 * TRIP_TIMING_GRACE_MINUTES, so a backlog never sends stale alerts, and the trigger worker's
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
    async run(now: Date = new Date()): Promise<{ notReported: number; detention: number }> {
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

      let detention = 0;
      const atPlant = await loadAlertRepository.findLoadsAtPlantSince(
        new Date(now.getTime() - FREE_LOADING_HOURS * MS_PER_HOUR),
      );
      for (const load of atPlant) {
        const overMinutes =
          (now.getTime() - load.atPlantAt.getTime()) / MS_PER_MINUTE - FREE_LOADING_HOURS * 60;
        if (overMinutes >= DETENTION_ALERT_MAX_HOURS * 60) continue;
        const step = Math.floor(overMinutes / detentionRepeatMinutes);
        if (overMinutes - step * detentionRepeatMinutes >= TRIP_TIMING_GRACE_MINUTES) continue;
        await triggers.enqueue('load.detention_at_loading', load.tenantId, {
          loadId: load.loadId,
          arrivedAt: load.atPlantAt.toISOString(),
          step,
        });
        detention++;
      }
      return { notReported, detention };
    },
  };
}
