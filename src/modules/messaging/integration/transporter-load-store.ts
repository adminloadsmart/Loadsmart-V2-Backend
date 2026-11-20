import { Brackets, DataSource, In } from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadActivityEntity } from '../../loads/entities/load-activity.entity';
import { LoadRecipientEntity } from '../../loads/load-posting/entities/load-recipient.entity';
import { LoadPostingEntity } from '../../loads/load-posting/entities/load-posting.entity';
import { PostAddress, RecipientReply } from '../../loads/load-posting/utils/load-posting.types';
import { BID_WINDOW_MS } from '../../loads/bids/bid-rules';
import {
  INDENT_OFFER_LOOKBACK_MS,
  LANE_LABEL_MAX_LENGTH,
  WHATSAPP_ANSWERABLE_LOAD_STATUSES,
  WHATSAPP_ANSWERABLE_POSTING_TYPES,
} from '../messaging.constants';
import { InboundResolution } from '../messaging.types';
import { WhatsappInboundRepository } from '../repositories/whatsapp-inbound.repository';
import { TransporterOffer, TransporterOfferStore } from './transporter-reply-actions';

/** The forms a stored transporter phone may take for a WhatsApp sender "91XXXXXXXXXX". */
export function phoneVariantsOf(senderPhone: string): string[] {
  const digits = senderPhone.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return [...new Set([digits, national, `91${national}`, `+91${national}`])];
}

function placeOf(address: PostAddress): string {
  return address.areaLocality || address.city || address.label;
}

/** "Gurugram → Ludhiana · 24 ft" — never the shipper's or customer's name. */
export function laneLabelOf(posting: LoadPostingEntity): string {
  const truck = posting.truckLengthFt ? ` · ${posting.truckLengthFt} ft` : '';
  return `${placeOf(posting.pickupAddress)} → ${posting.dropAddress.city || placeOf(posting.dropAddress)}${truck}`.slice(
    0,
    LANE_LABEL_MAX_LENGTH,
  );
}

/** "loadId|transporterId" — an indent acceptance the shipper recorded on a transporter's behalf. */
function onBehalfKey(loadId: string, transporterId: string): string {
  return `${loadId}|${transporterId}`;
}

function toOffer(
  recipient: LoadRecipientEntity,
  load: LoadEntity,
  acceptedOnBehalf: ReadonlySet<string>,
): TransporterOffer {
  return {
    recipientId: recipient.id,
    tenantId: recipient.tenantId,
    transporterId: recipient.transporterId!,
    loadId: load.id,
    loadCode: load.code,
    postingType: load.postingType,
    loadStatus: load.status,
    loadTransporterId: load.transporterId,
    postedAt: recipient.posting.createdAt,
    priceMode: recipient.posting.priceMode,
    postedRate: recipient.posting.rate,
    laneLabel: laneLabelOf(recipient.posting),
    awarded: load.awardedBidId !== null,
    memoAccepted: load.memoAcceptedAt !== null,
    acceptedOnBehalf: acceptedOnBehalf.has(onBehalfKey(load.id, recipient.transporterId!)),
  };
}

/**
 * Reads for the transporter side of WhatsApp replies: which posted loads a phone can still
 * answer (across every tenant that has this number as a transporter — finding G3), one offer by
 * recipient + load, and the last offer answer kept on whatsapp_inbound.
 */
export class TypeormTransporterOfferStore implements TransporterOfferStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inboundRepository: WhatsappInboundRepository,
  ) {}

  async findOpenOffersForPhone(senderPhone: string, now: Date): Promise<TransporterOffer[]> {
    const phones = phoneVariantsOf(senderPhone);
    const marketSince = new Date(now.getTime() - BID_WINDOW_MS);
    const indentSince = new Date(now.getTime() - INDENT_OFFER_LOOKBACK_MS);
    const recipients = await this.dataSource
      .getRepository(LoadRecipientEntity)
      .createQueryBuilder('recipient')
      .innerJoinAndSelect('recipient.posting', 'posting')
      .innerJoin('recipient.transporter', 'transporter')
      .where('recipient.recipientType = :transporterType', { transporterType: 'transporter' })
      .andWhere('transporter.phone IN (:...phones)', { phones })
      .andWhere(
        new Brackets((window) =>
          window
            .where("posting.mode = 'market_fleet' AND posting.createdAt >= :marketSince", {
              marketSince,
            })
            // An awarded market load still takes the driver details after the bid window
            // (LS_N_0121), until the memo is accepted — transporterStage decides.
            .orWhere(
              "posting.mode = 'market_fleet' AND posting.createdAt >= :indentSince AND EXISTS (" +
                'SELECT 1 FROM loads.loads awarded WHERE awarded.posting_id = posting.id ' +
                'AND awarded.awarded_bid_id IS NOT NULL AND awarded.memo_accepted_at IS NULL ' +
                'AND awarded.transporter_id = recipient.transporterId)',
              { indentSince },
            )
            .orWhere("posting.mode = 'indent' AND posting.createdAt >= :indentSince", {
              indentSince,
            }),
        ),
      )
      .getMany();
    if (recipients.length === 0) return [];

    const loads = await this.dataSource.getRepository(LoadEntity).find({
      where: {
        postingId: In([...new Set(recipients.map((recipient) => recipient.postingId))]),
        status: In([...WHATSAPP_ANSWERABLE_LOAD_STATUSES]),
        postingType: In([...WHATSAPP_ANSWERABLE_POSTING_TYPES]),
      } as never,
      order: { code: 'ASC' },
    });
    const onBehalf = await this.acceptedOnBehalf(loads);
    return recipients.flatMap((recipient) =>
      loads
        .filter(
          (load) => load.postingId === recipient.postingId && load.tenantId === recipient.tenantId,
        )
        .map((load) => toOffer(recipient, load, onBehalf)),
    );
  }

  /**
   * One offer by the ref our message carried: the load_recipients id on the offer itself
   * (LS_N_0119 / 0120), or the transporter's own id on the notices after it (LS_N_0121, 0123…),
   * which then needs the load to find its recipient row.
   */
  async findOffer(
    recipientId: string,
    loadId: string | null,
    loadRef: string,
  ): Promise<TransporterOffer | null> {
    const recipient =
      (await this.dataSource
        .getRepository(LoadRecipientEntity)
        .findOne({ where: { id: recipientId }, relations: { posting: true } })) ??
      (await this.recipientByTransporter(recipientId, loadId));
    if (!recipient || recipient.recipientType !== 'transporter' || !recipient.transporterId)
      return null;
    const load = await this.dataSource
      .getRepository(LoadEntity)
      .findOneBy(
        loadId
          ? { id: loadId, tenantId: recipient.tenantId, postingId: recipient.postingId }
          : { code: loadRef, tenantId: recipient.tenantId, postingId: recipient.postingId },
      );
    return load ? toOffer(recipient, load, await this.acceptedOnBehalf([load])) : null;
  }

  /** Indent loads at Created whose acceptance the shipper recorded for a transporter (the
   *  INDENT_ACCEPTED activity, per load) — as "loadId|transporterId". */
  private async acceptedOnBehalf(loads: LoadEntity[]): Promise<Set<string>> {
    const ids = loads
      .filter((load) => load.postingType === 'indent' && load.status === 'created')
      .map((load) => load.id);
    if (ids.length === 0) return new Set();
    const rows = await this.dataSource.getRepository(LoadActivityEntity).find({
      select: { loadId: true, metadata: true },
      where: { loadId: In(ids), action: 'INDENT_ACCEPTED' },
    });
    const keys = new Set<string>();
    for (const row of rows) {
      const transporterId = row.metadata?.transporterId;
      if (typeof transporterId === 'string') keys.add(onBehalfKey(row.loadId, transporterId));
    }
    return keys;
  }

  private async recipientByTransporter(
    transporterId: string,
    loadId: string | null,
  ): Promise<LoadRecipientEntity | null> {
    if (!loadId) return null;
    const load = await this.dataSource.getRepository(LoadEntity).findOneBy({ id: loadId });
    if (!load?.postingId) return null;
    return this.dataSource.getRepository(LoadRecipientEntity).findOne({
      where: {
        postingId: load.postingId,
        tenantId: load.tenantId,
        transporterId,
        recipientType: 'transporter',
      },
      relations: { posting: true },
    });
  }

  latestOfferAnswer(loadId: string, recipientId: string): Promise<InboundResolution | null> {
    return this.inboundRepository.findLatestOfferAnswer(loadId, recipientId);
  }

  async recordReply(recipientId: string, reply: RecipientReply, at: Date): Promise<void> {
    await this.dataSource
      .getRepository(LoadRecipientEntity)
      .update({ id: recipientId }, { replyStatus: reply, repliedAt: at });
  }
}
