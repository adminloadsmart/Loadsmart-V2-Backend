import type { LoadEntity } from '../entities/load.entity';

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

/** The driver-app push the reminder goes out through — DriverPushNotifier satisfies it. */
export interface DriverTripNotifier {
  notifyTripReminder(
    tenantId: string,
    driverId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<void>;
}
