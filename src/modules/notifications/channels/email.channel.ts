import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';

/**
 * Placeholder — no email provider has been chosen yet (SES/SendGrid/SMTP are all candidates).
 * Logs instead of actually sending, so the rest of the dispatch pipeline (queue, retries,
 * delivery-status tracking) is exercisable end-to-end today. Swap this one file for a real
 * provider later — NotificationChannel's interface and how it's wired in index.ts don't change.
 */
export class EmailChannel implements NotificationChannel {
  async send(notification: NotificationEntity, destination: string): Promise<void> {
    console.log(
      `[EmailChannel] (no provider configured — logging only) would send "${notification.title}" to ${destination}`,
    );
  }
}
