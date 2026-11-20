import { DataSource, In, IsNull } from 'typeorm';
import { LoadRecipientEntity } from '../../loads/load-posting/entities/load-recipient.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { DeliveryStatusListener } from '../inbound/inbound-pipeline.service';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { REACHED_DELIVERY_STATUSES } from '../messaging.constants';

/**
 * Keeps loads.load_recipients honest once WhatsApp reports on an offer, for the shipper's "Who is
 * quoting": any of sent / delivered / read → `sent` (with sent_at), and the first delivered_at /
 * read_at; failed → `failed` with WhatsApp's reason, but only while nothing has reached the
 * transporter yet (one posting can send several offers, one per load).
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
      const id = messageLog.recipientRefId;
      await recipients.update(
        { id, messageStatus: In(['pending', 'failed']) },
        {
          messageStatus: 'sent',
          sentAt: patch.sentAt ?? patch.deliveredAt ?? patch.readAt ?? new Date(),
          failReason: null,
        },
      );
      // First time only: a later offer of the same posting must not move these.
      const deliveredAt = patch.deliveredAt ?? patch.readAt;
      if (deliveredAt) await recipients.update({ id, deliveredAt: IsNull() }, { deliveredAt });
      if (patch.readAt) await recipients.update({ id, readAt: IsNull() }, { readAt: patch.readAt });
    } else if (patch.status === 'failed') {
      await recipients.update(
        { id: messageLog.recipientRefId, messageStatus: 'pending' },
        { messageStatus: 'failed', failReason: failReasonOf(patch.error) },
      );
    }
  }
}

/** WhatsApp's failure title ("Message undeliverable"), else its code — kept short for the shipper. */
export function failReasonOf(error: Record<string, unknown> | null | undefined): string | null {
  const title = typeof error?.title === 'string' ? error.title : null;
  const code = error?.code !== undefined ? String(error.code) : null;
  return (title ?? (code ? `WhatsApp error ${code}` : null))?.slice(0, 300) ?? null;
}
