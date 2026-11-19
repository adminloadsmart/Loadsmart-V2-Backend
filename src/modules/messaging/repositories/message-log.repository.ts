import { DataSource, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { MessageLogEntity } from '../entities/message-log.entity';

export type MessageLogPatch = Partial<
  Pick<
    MessageLogEntity,
    | 'status'
    | 'providerMessageId'
    | 'providerRequestId'
    | 'suppressedReason'
    | 'sentAt'
    | 'deliveredAt'
    | 'readAt'
    | 'failedAt'
    | 'error'
  >
>;

export class MessageLogRepository {
  private readonly repository: Repository<MessageLogEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(MessageLogEntity);
  }

  findByProviderMessageId(providerMessageId: string): Promise<MessageLogEntity | null> {
    return this.repository.findOne({ where: { providerMessageId } });
  }

  async create(row: Partial<MessageLogEntity>): Promise<MessageLogEntity> {
    return this.repository.save(this.repository.create(row));
  }

  /** Many rows at once (the notifications sent-log mirror). */
  async createMany(rows: Partial<MessageLogEntity>[]): Promise<void> {
    if (rows.length)
      await this.repository.insert(rows as QueryDeepPartialEntity<MessageLogEntity>[]);
  }

  /** Every message about one load, oldest first; scoped to a tenant when given. */
  listForLoad(loadId: string, tenantId?: string): Promise<MessageLogEntity[]> {
    return this.repository.find({
      where: { loadId, ...(tenantId ? { tenantId } : {}) },
      order: { createdAt: 'ASC' },
    });
  }

  findById(messageLogId: string): Promise<MessageLogEntity | null> {
    return this.repository.findOne({ where: { id: messageLogId } });
  }

  /** Newest row for a provider request id still missing its WAMID (MSG91 backfill). */
  findAwaitingMessageIdByRequestId(providerRequestId: string): Promise<MessageLogEntity | null> {
    return this.repository
      .createQueryBuilder('messageLog')
      .where('messageLog.providerRequestId = :providerRequestId', { providerRequestId })
      .andWhere('messageLog.providerMessageId IS NULL')
      .orderBy('messageLog.createdAt', 'DESC')
      .getOne();
  }

  findAwaitingMessageIdByAddress(address: string, since: Date): Promise<MessageLogEntity | null> {
    return this.repository
      .createQueryBuilder('messageLog')
      .where('messageLog.address = :address', { address })
      .andWhere('messageLog.channel = :channel', { channel: 'whatsapp' })
      .andWhere('messageLog.providerMessageId IS NULL')
      .andWhere('messageLog.status IN (:...statuses)', { statuses: ['queued', 'submitted'] })
      .andWhere('messageLog.createdAt >= :since', { since })
      .orderBy('messageLog.createdAt', 'DESC')
      .getOne();
  }

  /** WhatsApp rows about a load sent to this address since `since` that were not failed or
   *  suppressed, newest first (the router's "which load did we last ask" lookup). */
  findRecentLoadMessagesTo(address: string, since: Date): Promise<MessageLogEntity[]> {
    return this.repository.find({
      where: {
        address,
        channel: 'whatsapp',
        loadRef: Not(IsNull()),
        status: Not(In(['failed', 'suppressed'])),
        createdAt: MoreThanOrEqual(since),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async update(messageLogId: string, patch: MessageLogPatch): Promise<void> {
    await this.repository.update(
      { id: messageLogId },
      patch as QueryDeepPartialEntity<MessageLogEntity>,
    );
  }
}
