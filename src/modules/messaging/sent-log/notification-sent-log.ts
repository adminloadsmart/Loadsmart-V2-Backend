import {
  NotificationSentEntry,
  NotificationSentLog,
} from '../../notifications/notifications.interface';
import { MessageLogEntity } from '../entities/message-log.entity';
import { MessageLogRepository } from '../repositories/message-log.repository';
import { MESSAGING_ACTORS } from '../messaging.constants';

/** Mirrors load notifications to shipper users into message_log, so one table holds every message
 *  about a load (task 3). The notification's own delivery tracking stays in notification_deliveries. */
export class MessageLogNotificationSentLog implements NotificationSentLog {
  constructor(private readonly messageLogs: Pick<MessageLogRepository, 'createMany'>) {}

  async record(entries: NotificationSentEntry[]): Promise<void> {
    await this.messageLogs.createMany(
      entries.map((entry): Partial<MessageLogEntity> => ({
        tenantId: entry.tenantId,
        loadId: entry.loadId,
        recipientKind: 'shipper_user',
        recipientRefId: entry.recipient.id,
        recipientName: entry.recipient.name,
        address: entry.address,
        channel: entry.channel,
        provider: null,
        kind: null,
        templateKey: entry.type,
        renderedText: `${entry.title} — ${entry.body}`,
        intent: entry.intent,
        status: entry.status,
        suppressedReason: entry.suppressedReason ?? null,
        actor: MESSAGING_ACTORS.notifications,
      })),
    );
  }
}
