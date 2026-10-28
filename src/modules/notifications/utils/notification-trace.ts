import { TRACED_NOTIFICATION_TYPES } from '../notifications.constants';
import { NotificationTypeKey } from '../notifications.interface';

/**
 * Step-by-step logs for the types in TRACED_NOTIFICATION_TYPES, so a server's logs show exactly
 * where a notification stopped (not queued, dropped by its resolver, no recipient, every medium
 * off, a channel failing…). Every line starts with the sheet code and type, e.g.
 * `[LS_N_0006 user.access_changed]`. Untraced types log nothing.
 */
function tracePrefix(type: string): string | null {
  const code = TRACED_NOTIFICATION_TYPES[type as NotificationTypeKey];
  return code ? `[${code} ${type}]` : null;
}

export function traceNotification(type: string, message: string): void {
  const prefix = tracePrefix(type);
  if (prefix) console.log(`${prefix} ${message}`);
}

/** A failure on a traced type's path — always logged (as a warning), prefixed when traced. */
export function warnNotification(type: string, message: string, error: unknown): void {
  const prefix = tracePrefix(type);
  console.warn(prefix ? `${prefix} ${message}` : message, error);
}
