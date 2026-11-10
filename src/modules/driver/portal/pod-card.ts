import { DRIVER_MESSAGE_PARAMS_KEY } from '../../notifications/notifications.constants';
import { NotificationEntity } from '../../notifications/notifications.entity';
import { DELIVERED_LOAD_STATUSES } from '../../loads/utils/loads.types';
import { DRIVER_POD_REMINDER_NOTIFICATION_TYPE } from '../driver.constants';
import {
  DriverNotificationItem,
  DriverPodCardStatus,
  PodCardLoad,
  PodCardLoadRef,
} from './driver-portal.types';

const nonEmptyStringOrNull = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

export function podCardLoadRefOf(notification: NotificationEntity): PodCardLoadRef | null {
  if (notification.type !== DRIVER_POD_REMINDER_NOTIFICATION_TYPE) return null;
  const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
  const params = (metadata[DRIVER_MESSAGE_PARAMS_KEY] ?? {}) as Record<string, unknown>;
  const loadId = nonEmptyStringOrNull(metadata.loadId);
  const loadCode = nonEmptyStringOrNull(params.loadCode);
  if (!loadId && !loadCode) return null;
  return { tenantId: notification.tenantId, loadId, loadCode };
}

/** Finds the card's load among those fetched for the page. */
export function podCardLoadOf(ref: PodCardLoadRef, loads: PodCardLoad[]): PodCardLoad | undefined {
  return loads.find((load) =>
    ref.loadId
      ? load.id === ref.loadId
      : load.tenantId === ref.tenantId && load.code === ref.loadCode,
  );
}

function podStatusOf(load: PodCardLoad): DriverPodCardStatus {
  switch (load.podStatus) {
    case 'pending':
      return 'under_review';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    default:
      return 'not_uploaded';
  }
}

/** Same rule as the app's upload button: at the unloading point with no E-POD, or delivered with
 *  the E-POD rejected (the resubmission). */
function canUploadNow(load: PodCardLoad): boolean {
  if (load.status === 'reached_unloading') return !load.podFileKey;
  return DELIVERED_LOAD_STATUSES.includes(load.status) && load.podStatus === 'rejected';
}

export function podCardStateOf(
  ref: PodCardLoadRef,
  load: PodCardLoad | undefined,
  driverId: string,
): DriverNotificationItem['pod'] {
  // A card whose load is gone or now someone else's — keep the id it was sent with, if any.
  if (!load || load.driverId !== driverId) {
    return ref.loadId ? { loadId: ref.loadId, status: 'unavailable', actionable: false } : null;
  }
  return { loadId: load.id, status: podStatusOf(load), actionable: canUploadNow(load) };
}
