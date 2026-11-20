import { DataSource, IsNull } from 'typeorm';
import { LsRequirementRecipientEntity } from '../../loadsmart-ops/entities/ls-requirement-recipient.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { DeliveryStatusListener } from '../inbound/inbound-pipeline.service';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { failReasonOf } from './load-recipient-status.listener';

/**
 * Keeps loads.ls_requirement_recipients honest once WhatsApp reports on a broker's requirement
 * (LS_N_0105 / LS_N_0106 sent by "Send requirement"): the first delivered_at and read_at, or
 * `failed` with WhatsApp's reason — spec "Sent and read status saved per broker".
 */
export class RequirementRecipientStatusListener implements DeliveryStatusListener {
  constructor(private readonly dataSource: DataSource) {}

  async onStatusApplied(messageLog: MessageLogEntity, patch: MessageLogPatch): Promise<void> {
    if (messageLog.kind !== 'offer' || messageLog.recipientKind !== 'partner') return;
    const rows = this.dataSource.getRepository(LsRequirementRecipientEntity);
    const messageLogId = messageLog.id;
    if (patch.status === 'failed') {
      await rows.update(
        { messageLogId, status: 'sent' },
        { status: 'failed', failReason: failReasonOf(patch.error) },
      );
      return;
    }
    const deliveredAt = patch.deliveredAt ?? patch.readAt;
    if (deliveredAt) await rows.update({ messageLogId, deliveredAt: IsNull() }, { deliveredAt });
    if (patch.readAt)
      await rows.update({ messageLogId, readAt: IsNull() }, { readAt: patch.readAt });
  }
}
