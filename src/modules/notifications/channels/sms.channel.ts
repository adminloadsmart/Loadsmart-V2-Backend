import { Msg91Client } from '../../../adapters/msg91.client';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';
import { getNotificationTemplates, mapTemplateVariables } from '../catalog/notification-catalog';

/** A type with its own `templates.sms` (see the notification catalog) sends through that DLT
 *  Flow template with variables mapped from metadata; any other type keeps the generic
 *  title/body template from env. */
export class SmsChannel implements NotificationChannel {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(notification: NotificationEntity, destination: string): Promise<void> {
    const template = getNotificationTemplates(notification.type)?.sms;
    if (template) {
      if (!template.templateId) {
        throw new Error(
          `No SMS template configured for notification type "${notification.type}" — set its MSG91_SMS_TEMPLATE_* env var`,
        );
      }
      await this.msg91Client.sendTransactional(
        destination,
        mapTemplateVariables(template.variables, notification.metadata),
        template.templateId,
      );
      return;
    }
    await this.msg91Client.sendTransactional(destination, {
      title: notification.title,
      body: notification.body,
    });
  }
}
