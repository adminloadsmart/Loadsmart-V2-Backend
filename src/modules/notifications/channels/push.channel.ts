import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../../config/env';
import { DRIVER_MESSAGE_PARAMS_KEY } from '../notifications.constants';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';

let app: App | null = null;

/** Data keys FCM rejects outright ("Invalid data payload key") — e.g. load.assigned's `from`
 *  (pickup city). Left out of the push; the stored notification keeps them. */
const FCM_RESERVED_DATA_KEYS = new Set(['from', 'message_type', 'collapse_key']);
const isFcmReservedDataKey = (key: string): boolean =>
  FCM_RESERVED_DATA_KEYS.has(key) || key.startsWith('google') || key.startsWith('gcm');

function getFirebaseApp(): App {
  if (app) return app;
  if (!env.firebaseProjectId || !env.firebaseClientEmail || !env.firebasePrivateKey) {
    throw new Error(
      'FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not configured — cannot send push notifications',
    );
  }
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }
  app = initializeApp({
    credential: cert({
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      // The private key is stored in env with literal `\n` (as exported in the service-account
      // JSON) — un-escape to real newlines for the PEM parser.
      privateKey: env.firebasePrivateKey.replace(/\\n/g, '\n'),
    }),
  });
  return app;
}

/** Real Firebase Cloud Messaging integration. This module owns no device-token registry — the
 *  caller passes the exact token to send to (see notifications module Context notes); an
 *  invalid/unregistered token is just a failed delivery, same as any other channel error. */
export class PushChannel implements NotificationChannel {
  async send(notification: NotificationEntity, destination: string): Promise<void> {
    const messaging = getMessaging(getFirebaseApp());
    await messaging.send({
      token: destination,
      notification: { title: notification.title, body: notification.body },
      // `severity` rides alongside metadata so the app can style/prioritize the push the same way
      // as the in-app list — an extra data key, ignored by clients that don't read it.
      data: {
        // messageParams only rebuilds the text in another language — not for the app.
        ...(notification.metadata
          ? Object.fromEntries(
              Object.entries(notification.metadata)
                .filter(([key]) => key !== DRIVER_MESSAGE_PARAMS_KEY && !isFcmReservedDataKey(key))
                // FCM data is strings only — objects (e.g. load.assigned's fleetOwner) go as JSON,
                // not "[object Object]". Arrays keep their "a,b" form (loadIds), as before.
                .map(([key, value]) => [
                  key,
                  value !== null && typeof value === 'object' && !Array.isArray(value)
                    ? JSON.stringify(value)
                    : String(value),
                ]),
            )
          : {}),
        // FCM rejects a non-string data value, so an unset severity (DriverPushNotifier's ad hoc
        // pushes carry none) is left out rather than sent as undefined.
        ...(notification.severity && { severity: notification.severity }),
      },
    });
  }
}
