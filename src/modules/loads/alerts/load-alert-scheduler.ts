import { JobQueue } from '../../../jobs/queue-registry';
import { LoadEntity } from '../entities/load.entity';
import { LoadStatus } from '../utils/loads.types';
import { reminderTimes, POD_REMINDER_EVERY_MS, POD_REMINDER_MAX } from './alert-rules';
import { NotificationTriggers } from '../../notifications/notifications.interface';
import { PodReminderJobPayload, LoadSchedule } from '../utils/load-alert.interface';

export const LOAD_REMINDERS_QUEUE = 'load-reminders';
export const POD_REMINDER_JOB = 'pod-reminder';

/**
 * Queues the no-tracking alerts as a load enters a stage (LoadStageService's onStageEntered hook,
 * and posting for own-fleet loads created at Truck assigned):
 * - Truck assigned → the shipper is asked 2 h and 1 h before pickup whether the truck reached.
 * - Loaded → the same, 2 h and 1 h before the drop ETA.
 * - Reached unloading → the driver is reminded every 30 minutes to upload the E-POD.
 * Each alert checks the load again when it fires and is dropped once the stage has moved on —
 * that's how they're cancelled. Never throws: a failed alert must not fail the move.
 */
export class LoadAlertScheduler {
  constructor(
    private readonly triggers: NotificationTriggers,
    private readonly remindersQueue: JobQueue,
    private readonly scheduleOf: LoadSchedule,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onStageEntered = async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    try {
      if (to === 'truck_assigned') {
        const { pickupAt } = await this.scheduleOf(load);
        await this.queueArrivalReminders('load.pickup_reminder', load, pickupAt);
      } else if (to === 'loaded') {
        const { dropDueAt } = await this.scheduleOf(load);
        await this.queueArrivalReminders('load.drop_reminder', load, dropDueAt);
      } else if (to === 'reached_unloading' && load.driverId) {
        // Only drivers with the app can be reminded; others arrive with WhatsApp (Phase 5).
        for (let sequence = 1; sequence <= POD_REMINDER_MAX; sequence++) {
          const payload: PodReminderJobPayload = {
            tenantId: load.tenantId,
            loadId: load.id,
            sequence,
          };
          await this.remindersQueue.enqueue(POD_REMINDER_JOB, payload, {
            delay: sequence * POD_REMINDER_EVERY_MS,
            jobId: `${POD_REMINDER_JOB}__${load.id}__${sequence}`,
          });
        }
      }
    } catch (error) {
      console.warn(`[load-alerts] could not queue alerts for load ${load.id} at ${to}`, error);
    }
  };

  private async queueArrivalReminders(
    type: 'load.pickup_reminder' | 'load.drop_reminder',
    load: LoadEntity,
    dueAt: Date | null,
  ): Promise<void> {
    if (!dueAt) return;
    for (const { leadMinutes, sendInMs } of reminderTimes(dueAt, this.now())) {
      await this.triggers.enqueue(
        type,
        load.tenantId,
        { loadId: load.id, leadMinutes, dueAt: dueAt.toISOString() },
        { delayMs: sendInMs },
      );
    }
  }
}
