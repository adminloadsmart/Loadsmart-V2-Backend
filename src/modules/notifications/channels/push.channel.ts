import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../../config/env';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';

let app: App | null = null;

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
      data: notification.metadata
        ? Object.fromEntries(Object.entries(notification.metadata).map(([k, v]) => [k, String(v)]))
        : undefined,
    });
  }
}
