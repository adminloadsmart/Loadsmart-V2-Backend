import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceEventNotifier } from './utils/geofence.interface';

/**
 * "Send alerts to" on a geofence: one in-app notification per chosen teammate whose channels
 * include 'app'. WhatsApp / email are accepted and stored on the geofence but not delivered yet —
 * both channels are driven by per-type MSG91 templates (notifications/catalog), and none exists for
 * geofence alerts. Never throws (same contract as LoadEventNotifier): the transition is already
 * recorded by the time this runs.
 */
export function createGeofenceEventNotifier(
  notificationsService: NotificationsService,
): GeofenceEventNotifier {
  return async (event) => {
    const entered = event.event === 'enter';
    const vehicle = event.vehicleNumber ?? 'A truck';
    await Promise.all(
      event.recipients
        .filter((recipient) => recipient.channels.includes('app'))
        .map(async (recipient) => {
          try {
            await notificationsService.send(event.tenantId, {
              recipientUserId: recipient.userId,
              type: entered ? 'geofence.entered' : 'geofence.exited',
              title: `${vehicle} ${entered ? 'entered' : 'left'} ${event.geofenceName}`,
              body: `${vehicle} ${entered ? 'entered' : 'left'} ${event.geofenceName} at ${event.at.toISOString()}.`,
              metadata: {
                geofenceId: event.geofenceId,
                vehicleId: event.vehicleId,
                loadId: event.loadId,
              },
              severity: 'p3_info',
            });
          } catch (error) {
            console.warn(
              `Failed to send geofence alert to user ${recipient.userId} for geofence ${event.geofenceId}`,
              error,
            );
          }
        }),
    );
  };
}
