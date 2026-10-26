/** "Alerts 2 h and 1 h before" — pickup and drop ETA, when there is no tracking. */
export const ARRIVAL_REMINDER_LEADS_MINUTES = [120, 60] as const;

/** "Reminds the driver every 30 minutes until the POD is in" — capped at 6 hours. */
export const POD_REMINDER_EVERY_MS = 30 * 60 * 1000;
export const POD_REMINDER_MAX = 12;

/** The arrival reminders still ahead of `now`, with how long until each is sent. A reminder whose
 *  time has already passed (the load was assigned late) is skipped. */
export function reminderTimes(dueAt: Date, now: Date): { leadMinutes: number; sendInMs: number }[] {
  return ARRIVAL_REMINDER_LEADS_MINUTES.map((leadMinutes) => ({
    leadMinutes,
    sendInMs: dueAt.getTime() - leadMinutes * 60_000 - now.getTime(),
  })).filter(({ sendInMs }) => sendInMs > 0);
}
