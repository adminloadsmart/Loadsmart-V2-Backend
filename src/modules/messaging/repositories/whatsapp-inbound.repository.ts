import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { NormalizedMessage } from '../providers/whatsapp-provider.interface';
import { InboundResolution, RoutingMethod } from '../messaging.types';
import {
  DECISIVE_RESOLUTIONS,
  INBOUND_SENDER_BATCH_SIZE,
  OFFER_ANSWER_RESOLUTIONS,
} from '../messaging.constants';

export interface InboundResolutionPatch {
  resolution: InboundResolution;
  resolutionNote?: string | null;
  routingMethod?: RoutingMethod;
  matchedMessageLogId?: string | null;
  loadId?: string | null;
  loadRef?: string | null;
  recipientRefId?: string | null;
  parsedValues?: Record<string, unknown> | null;
  pickerMessageLogId?: string | null;
  media?: Record<string, unknown> | null;
}

export class WhatsappInboundRepository {
  private readonly repository: Repository<WhatsappInboundEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(WhatsappInboundEntity);
  }

  /**
   * Stores an inbound message once. A re-delivered webhook hits the unique
   * (provider, provider_message_id) index and returns null instead of a second row.
   */
  async insertIfNew(message: NormalizedMessage): Promise<WhatsappInboundEntity | null> {
    const insertResult = await this.repository
      .createQueryBuilder()
      .insert()
      .into(WhatsappInboundEntity)
      .values(<QueryDeepPartialEntity<WhatsappInboundEntity>>{
        provider: message.provider,
        providerMessageId: message.providerMessageId,
        fromPhone: message.fromPhone,
        fromUserId: message.fromUserId,
        type: message.type,
        providerType: message.providerType,
        body: message.text,
        buttonId: message.buttonId,
        buttonText: message.buttonText,
        listRowId: message.listRowId,
        flowResponse: message.flowResponse,
        media: message.media ? { ...message.media } : null,
        contextMessageId: message.contextMessageId,
        raw: message.raw as object,
        receivedAt: message.timestamp,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const insertedId = (insertResult.raw as { id?: string }[])[0]?.id;
    return insertedId ? this.findById(insertedId) : null;
  }

  findById(inboundId: string): Promise<WhatsappInboundEntity | null> {
    return this.repository.findOne({ where: { id: inboundId } });
  }

  /** This sender's still-pending messages up to (and including) `upTo`, oldest first. */
  findPendingForSender(fromPhone: string, upTo: Date): Promise<WhatsappInboundEntity[]> {
    return this.repository
      .createQueryBuilder('inbound')
      .where('inbound.fromPhone = :fromPhone', { fromPhone })
      .andWhere('inbound.resolution = :pending', { pending: 'pending' })
      .andWhere('inbound.receivedAt <= :upTo', { upTo })
      .orderBy('inbound.receivedAt', 'ASC')
      .addOrderBy('inbound.createdAt', 'ASC')
      .take(INBOUND_SENDER_BATCH_SIZE)
      .getMany();
  }

  /** When this phone last wrote to us — the 24-h customer service window starts here. */
  async latestReceivedAtFrom(fromPhone: string): Promise<Date | null> {
    const latest = await this.repository.findOne({
      where: { fromPhone },
      order: { receivedAt: 'DESC' },
      select: { id: true, receivedAt: true },
    });
    return latest?.receivedAt ?? null;
  }

  findAwaitingPick(pickerMessageLogId: string): Promise<WhatsappInboundEntity | null> {
    return this.repository.findOne({
      where: { pickerMessageLogId, resolution: 'awaiting_load_pick' },
    });
  }

  findLatestAwaitingPickFrom(
    fromPhone: string,
    since: Date,
  ): Promise<WhatsappInboundEntity | null> {
    return this.repository.findOne({
      where: {
        fromPhone,
        resolution: 'awaiting_load_pick',
        receivedAt: MoreThanOrEqual(since),
      },
      order: { receivedAt: 'DESC' },
    });
  }

  /** Earliest decisive tap on one of our messages, ignoring the message being handled now. */
  findFirstDecision(
    messageLogId: string,
    excludeInboundId: string,
  ): Promise<WhatsappInboundEntity | null> {
    return this.repository
      .createQueryBuilder('inbound')
      .where('inbound.matchedMessageLogId = :messageLogId', { messageLogId })
      .andWhere('inbound.id != :excludeInboundId', { excludeInboundId })
      .andWhere('inbound.type = :button', { button: 'button' })
      .andWhere('inbound.resolution IN (:...decisive)', { decisive: [...DECISIVE_RESOLUTIONS] })
      .orderBy('inbound.receivedAt', 'ASC')
      .getOne();
  }

  /** The recipient's latest answer to the offer on this load (accepted / negotiating / rejected). */
  async findLatestOfferAnswer(
    loadId: string,
    recipientRefId: string,
  ): Promise<InboundResolution | null> {
    const latest = await this.repository
      .createQueryBuilder('inbound')
      .where('inbound.loadId = :loadId', { loadId })
      .andWhere('inbound.recipientRefId = :recipientRefId', { recipientRefId })
      .andWhere('inbound.resolution IN (:...answers)', { answers: [...OFFER_ANSWER_RESOLUTIONS] })
      .orderBy('inbound.receivedAt', 'DESC')
      .getOne();
    return latest?.resolution ?? null;
  }

  /** Every WhatsApp reply routed to one load, oldest first. */
  listForLoad(loadId: string): Promise<WhatsappInboundEntity[]> {
    return this.repository.find({ where: { loadId }, order: { receivedAt: 'ASC' } });
  }

  async recordResolution(inboundId: string, patch: InboundResolutionPatch): Promise<void> {
    await this.repository.update(
      { id: inboundId },
      patch as QueryDeepPartialEntity<WhatsappInboundEntity>,
    );
  }
}
