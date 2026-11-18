import { MessageLogEntity } from '../entities/message-log.entity';
import { MessageLogPatch, MessageLogRepository } from '../repositories/message-log.repository';
import { WhatsappInboundRepository } from '../repositories/whatsapp-inbound.repository';
import { OutboundMessageStore } from './outbound-message.service';

/** OutboundMessageStore over the two messaging tables. */
export class RepositoryOutboundMessageStore implements OutboundMessageStore {
  constructor(
    private readonly messageLogRepository: MessageLogRepository,
    private readonly inboundRepository: WhatsappInboundRepository,
  ) {}

  createMessageLog(row: Partial<MessageLogEntity>): Promise<MessageLogEntity> {
    return this.messageLogRepository.create(row);
  }

  updateMessageLog(messageLogId: string, patch: MessageLogPatch): Promise<void> {
    return this.messageLogRepository.update(messageLogId, patch);
  }

  latestInboundAt(phone: string): Promise<Date | null> {
    return this.inboundRepository.latestReceivedAtFrom(phone);
  }

  async findInboundProviderMessageId(inboundId: string): Promise<string | null> {
    return (await this.inboundRepository.findById(inboundId))?.providerMessageId ?? null;
  }
}
