import { DataSource, In } from 'typeorm';
import { LoadRecipientEntity } from '../../loads/load-posting/entities/load-recipient.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { DeliveryStatusListener } from '../inbound/inbound-pipeline.service';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { REACHED_DELIVERY_STATUSES } from '../messaging.constants';

/**
 * Keeps loads.load_recipients.message_status honest once WhatsApp reports on an offer: any of
 * sent / delivered / read → `sent` (with sent_at); failed → `failed`, but only while nothing has
 * reached the transporter yet (one posting can send several offers, one per load).
 */
export class LoadRecipientStatusListener implements DeliveryStatusListener {
  constructor(private readonly dataSource: DataSource) {}

  async onStatusApplied(messageLog: MessageLogEntity, patch: MessageLogPatch): Promise<void> {
    if (
      messageLog.kind !== 'offer' ||
      messageLog.recipientKind !== 'transporter' ||
      !messageLog.recipientRefId
    )
      return;
    const recipients = this.dataSource.getRepository(LoadRecipientEntity);
    if (patch.status && REACHED_DELIVERY_STATUSES.includes(patch.status)) {
      await recipients.update(
        { id: messageLog.recipientRefId, messageStatus: In(['pending', 'failed']) },
        {
          messageStatus: 'sent',
          sentAt: patch.sentAt ?? patch.deliveredAt ?? patch.readAt ?? new Date(),
        },
      );
    } else if (patch.status === 'failed') {
      await recipients.update(
        { id: messageLog.recipientRefId, messageStatus: 'pending' },
        { messageStatus: 'failed' },
      );
    }
  }
}
