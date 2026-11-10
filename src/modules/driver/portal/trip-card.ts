import { DRIVER_MESSAGE_PARAMS_KEY } from '../../notifications/notifications.constants';
import { NotificationEntity } from '../../notifications/notifications.entity';
import {
  COMPLETED_LOAD_STATUSES,
  ON_ROAD_LOAD_STATUSES,
  PRE_LOADED_LOAD_STATUSES,
  UNLOADED_LOAD_STATUSES,
} from '../../loads/utils/loads.types';
import {
  DRIVER_LOAD_ASSIGNED_NOTIFICATION_TYPE,
  DRIVER_LOADING_CONTACT_CHANGED_NOTIFICATION_TYPE,
  DRIVER_LOADING_POINT_CHANGED_NOTIFICATION_TYPE,
  DRIVER_TRIP_CARD_NOTIFICATION_TYPES,
} from '../driver.constants';
import {
  DRIVER_TRIP_CARD_STATUSES,
  DriverNotificationItem,
  DriverTripCardStatus,
  TripCardLoad,
  TripCardRef,
} from './driver-portal.types';

export function tripCardRefOf(notification: NotificationEntity): TripCardRef | null {
  if (!DRIVER_TRIP_CARD_NOTIFICATION_TYPES.includes(notification.type)) return null;
  const loadIds = (notification.metadata as Record<string, unknown> | null)?.loadIds;
  if (!Array.isArray(loadIds)) return null;
  const ids = loadIds.filter((id): id is string => typeof id === 'string' && id !== '');
  return ids.length ? { tenantId: notification.tenantId, loadIds: ids } : null;
}

const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** Whether a newer change has since replaced what this card told the driver. */
function isReplaced(notification: NotificationEntity, load: TripCardLoad): boolean {
  const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
  const params = (metadata[DRIVER_MESSAGE_PARAMS_KEY] ?? {}) as Record<string, unknown>;
  if (notification.type === DRIVER_LOADING_CONTACT_CHANGED_NOTIFICATION_TYPE) {
    return (
      stringOrNull(params.phoneNumber) !== load.loadingContactPhone ||
      stringOrNull(params.name) !== load.loadingContactName
    );
  }
  if (notification.type === DRIVER_LOADING_POINT_CHANGED_NOTIFICATION_TYPE) {
    // Saved since this flag was added; older cards are matched on the point's title.
    const pointId = stringOrNull(metadata.loadingPointId);
    return pointId
      ? pointId !== load.loadingPointId
      : stringOrNull(params.pointTitle) !== (load.loadingPoint?.title ?? null);
  }
  return false;
}

function loadStatusOf(
  notification: NotificationEntity,
  load: TripCardLoad | undefined,
  driverId: string,
): DriverTripCardStatus {
  if (!load) return 'unavailable';
  if (load.driverId !== driverId) return 'reassigned';
  if (!ON_ROAD_LOAD_STATUSES.includes(load.status)) {
    // Unloaded / money stages / closed — the trip is done; else the truck was taken off the load
    // (back to sourcing), which counts the same as handed to another driver.
    const tripOver =
      UNLOADED_LOAD_STATUSES.includes(load.status) || COMPLETED_LOAD_STATUSES.includes(load.status);
    return tripOver ? 'completed' : 'reassigned';
  }
  if (notification.type === DRIVER_LOAD_ASSIGNED_NOTIFICATION_TYPE) return 'active';
  // Loaded or later — the loading contact/point no longer matter.
  if (!PRE_LOADED_LOAD_STATUSES.includes(load.status)) return 'completed';
  return isReplaced(notification, load) ? 'replaced' : 'active';
}

export function tripCardStateOf(
  notification: NotificationEntity,
  ref: TripCardRef,
  loads: Map<string, TripCardLoad>,
  driverId: string,
): DriverNotificationItem['trip'] {
  const statuses = ref.loadIds.map((id) => {
    const load = loads.get(id);
    // A load id from another tenant is never this card's load.
    return loadStatusOf(notification, load?.tenantId === ref.tenantId ? load : undefined, driverId);
  });
  // On a several-loads card, the card is as live as its liveliest load (statuses are listed
  // most live first).
  const status = DRIVER_TRIP_CARD_STATUSES.find((candidate) => statuses.includes(candidate))!;
  return { loadIds: ref.loadIds, status, actionable: status === 'active' };
}
