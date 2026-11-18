import { MessageLogEntity } from '../entities/message-log.entity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogRepository } from '../repositories/message-log.repository';
import {
  InboundResolutionPatch,
  WhatsappInboundRepository,
} from '../repositories/whatsapp-inbound.repository';
import { RouterMessageStore } from './reply-router.ports';

/** RouterMessageStore over the two messaging tables. */
export class RepositoryRouterMessageStore implements RouterMessageStore {
  constructor(
    private readonly messageLogRepository: MessageLogRepository,
    private readonly inboundRepository: WhatsappInboundRepository,
  ) {}

  findMessageLogByProviderMessageId(providerMessageId: string): Promise<MessageLogEntity | null> {
    return this.messageLogRepository.findByProviderMessageId(providerMessageId);
  }

  findMessageLogById(messageLogId: string): Promise<MessageLogEntity | null> {
    return this.messageLogRepository.findById(messageLogId);
  }

  findAwaitingPick(pickerMessageLogId: string): Promise<WhatsappInboundEntity | null> {
    return this.inboundRepository.findAwaitingPick(pickerMessageLogId);
  }

  findFirstDecision(
    messageLogId: string,
    excludeInboundId: string,
  ): Promise<WhatsappInboundEntity | null> {
    return this.inboundRepository.findFirstDecision(messageLogId, excludeInboundId);
  }

  recordResolution(inboundId: string, patch: InboundResolutionPatch): Promise<void> {
    return this.inboundRepository.recordResolution(inboundId, patch);
  }
}
