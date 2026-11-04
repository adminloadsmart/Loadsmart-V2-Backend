import { Msg91Client } from '../../../adapters/msg91.client';
import { NotificationEntity } from '../notifications.entity';
import { NotificationChannel } from './notification-channel.interface';
import { getNotificationTemplates, mapTemplateVariables } from '../catalog/notification-catalog';
import { EMAIL_CTA_URL_KEY } from '../notifications.constants';

/**
 * MSG91 Email API — the subject/body live in an MSG91 dashboard template, so only types with a
 * `templates.email` entry in the notification catalog are actually emailed. Any other type keeps
 * channel skips them until they get a template of their own.
 */
export class EmailChannel implements NotificationChannel {
  constructor(private readonly msg91Client: Msg91Client) {}

  async send(notification: NotificationEntity, destination: string): Promise<void> {
    const template = getNotificationTemplates(notification.type)?.email;
    if (!template) return;
    if (!template.templateId) {
      throw new Error(
        `No email template configured for notification type "${notification.type}" — set its MSG91_EMAIL_TEMPLATE_* env var`,
      );
    }
    await this.msg91Client.sendEmail(
      { email: destination },
      {
        ...mapTemplateVariables(template.variables, notification.metadata),
        // Every email gets its button link; '' for a type with no link (see emailCtaPath).
        [EMAIL_CTA_URL_KEY]: String(notification.metadata?.[EMAIL_CTA_URL_KEY] ?? ''),
      },
      template.templateId,
    );
  }
}
