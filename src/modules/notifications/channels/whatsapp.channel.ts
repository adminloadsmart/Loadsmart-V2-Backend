import { Msg91Client } from '../../../adapters/msg91.client';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';

/**
 * Forwards structured variables straight through to an MSG91/WhatsApp-Business-approved template
 * — unlike EmailChannel/SmsChannel, it never composes the message text itself (WhatsApp Business
 * requires every template pre-approved by Meta, so the copy lives on the MSG91 dashboard, not
 * here). Producers put the template's variables on `notification.metadata` (see the notification
 * catalog's `buildContent`), in the exact order the approved template's {{1}}, {{2}}, {{3}}...
 * placeholders expect — WhatsApp templates are positional, not named, so whoever creates the
 * template in the MSG91 dashboard must match this producer's metadata key order.
 */
export class WhatsappChannel implements NotificationChannel {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(notification: NotificationEntity, destination: string): Promise<void> {
    const metadata = (notification.metadata ?? {}) as Record<string, string>;
    await this.msg91Client.sendWhatsapp(destination, Object.values(metadata));
  }
}
