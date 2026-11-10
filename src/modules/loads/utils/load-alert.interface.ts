import type { LoadEntity } from '../entities/load.entity';
import type { DriverMessage } from '../../notifications/notifications.types';

/** Load reminders (alerts/) — pickup/drop reminders and the POD reminder ladder. */

export interface PodReminderJobPayload {
  tenantId: string;
  loadId: string;
  /** 1-based — the n-th 30-minute reminder. */
  sequence: number;
}

/** One arrival reminder still ahead: its lead before the ETA and how long until it is sent. */
export interface ArrivalReminder {
  leadMinutes: number;
  sendInMs: number;
}

/** When a load is due at each end. */
export interface LoadDueTimes {
  pickupAt: Date | null;
  dropDueAt: Date | null;
}

/** When the load is due at each end — the posting's pickup time and deliver-by (drop ETA). */
export type LoadSchedule = (load: LoadEntity) => Promise<LoadDueTimes>;

/** The driver-app notifications the loads module sends (E-POD reminders, load updates) —
 *  DriverPushNotifier satisfies it. */
export interface DriverTripNotifier {
  /** `loadId` is saved on the in-app row (and rides on the push) so the card can follow the load. */
  notifyTripReminder(
    tenantId: string,
    driverId: string,
    message: DriverMessage,
    load?: { loadId: string },
  ): Promise<void>;
  /** New load assigned / loading contact or point changed: one in-app card always (signed in or
   *  not), plus a push to each signed-in device. Never throws. */
  notifyLoadUpdate(
    tenantId: string,
    driverId: string,
    message: DriverMessage,
    metadata: Record<string, unknown>,
  ): Promise<void>;
}
