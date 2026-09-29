import { Msg91Client } from '../../../adapters/msg91.client';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';
import { getNotificationTemplates, mapTemplateVariables } from '../catalog/notification-catalog';

/**
 * MSG91 Email API — the subject/body live in an MSG91 dashboard template, so only types with a
 * `templates.email` entry in the notification catalog are actually emailed. Any other type keeps
 * this channel's original placeholder behavior (log only) until it gets a template of its own.
 */
export class EmailChannel implements NotificationChannel {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(notification: NotificationEntity, destination: string): Promise<void> {
    const template = getNotificationTemplates(notification.type)?.email;
    if (!template) {
      console.log(
        `[EmailChannel] (no email template for "${notification.type}" — logging only) would send "${notification.title}" to ${destination}`,
      );
      return;
    }
    if (!template.templateId) {
      throw new Error(
        `No email template configured for notification type "${notification.type}" — set its MSG91_EMAIL_TEMPLATE_* env var`,
      );
    }
    await this.msg91Client.sendEmail(
      { email: destination },
      mapTemplateVariables(template.variables, notification.metadata),
      template.templateId,
    );
  }
}
