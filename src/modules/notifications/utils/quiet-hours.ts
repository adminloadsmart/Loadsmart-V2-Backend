import { NotificationSeverity } from '../notifications.types';
import { INDIA_UTC_OFFSET_MS, QUIET_HOURS_BYPASS_SEVERITY } from '../notifications.constants';
import { QuietHoursSetting } from '../notifications.interface';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

function minutesSinceMidnight(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * How long to hold a notification's interrupting channels (QUIET_HOURS_HELD_CHANNELS) right now:
 * 0 when quiet hours are off, outside the window, or the severity bypasses them; otherwise the ms
 * until the window ends. Handles windows that wrap midnight (22:00 → 07:00).
 */
export function getQuietHoursDelayMs(
  setting: QuietHoursSetting | null,
  severity: NotificationSeverity,
  now: Date = new Date(),
): number {
  if (!setting?.enabled || severity === QUIET_HOURS_BYPASS_SEVERITY) return 0;
  const windowStartMinutes = minutesSinceMidnight(setting.startTime);
  const windowEndMinutes = minutesSinceMidnight(setting.endTime);
  if (windowStartMinutes === windowEndMinutes) return 0;

  const indiaTimeMs = now.getTime() + INDIA_UTC_OFFSET_MS;
  const msSinceIndiaMidnight = ((indiaTimeMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const currentMinutes = msSinceIndiaMidnight / MS_PER_MINUTE;
  const isInsideWindow =
    windowStartMinutes < windowEndMinutes
      ? currentMinutes >= windowStartMinutes && currentMinutes < windowEndMinutes
      : currentMinutes >= windowStartMinutes || currentMinutes < windowEndMinutes;
  if (!isInsideWindow) return 0;

  const windowEndMs = windowEndMinutes * MS_PER_MINUTE;
  return windowEndMs > msSinceIndiaMidnight
    ? windowEndMs - msSinceIndiaMidnight
    : MS_PER_DAY - msSinceIndiaMidnight + windowEndMs;
}
