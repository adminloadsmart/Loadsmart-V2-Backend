import { DataSource } from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { MessageLogRepository } from '../repositories/message-log.repository';
import { WhatsappInboundRepository } from '../repositories/whatsapp-inbound.repository';
import { SentLogLoadLookup, SentLogStore } from './message-log-query.service';

export class RepositorySentLogStore implements SentLogStore {
  constructor(
    private readonly messageLogs: MessageLogRepository,
    private readonly inbound: WhatsappInboundRepository,
  ) {}

  listMessagesForLoad(loadId: string, tenantId?: string) {
    return this.messageLogs.listForLoad(loadId, tenantId);
  }

  listRepliesForLoad(loadId: string) {
    return this.inbound.listForLoad(loadId);
  }
}

export class TypeormSentLogLoadLookup implements SentLogLoadLookup {
  constructor(private readonly dataSource: DataSource) {}

  findLoad(loadId: string, tenantId?: string) {
    return this.dataSource.getRepository(LoadEntity).findOne({
      where: { id: loadId, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, tenantId: true, route: true },
    });
  }
}
