import { Brackets, DataSource, In } from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadRecipientEntity } from '../../loads/load-posting/entities/load-recipient.entity';
import { LoadPostingEntity } from '../../loads/load-posting/entities/load-posting.entity';
import { PostAddress } from '../../loads/load-posting/utils/load-posting.types';
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

function toOffer(recipient: LoadRecipientEntity, load: LoadEntity): TransporterOffer {
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
    return recipients.flatMap((recipient) =>
      loads
        .filter(
          (load) => load.postingId === recipient.postingId && load.tenantId === recipient.tenantId,
        )
        .map((load) => toOffer(recipient, load)),
    );
  }

  async findOffer(
    recipientId: string,
    loadId: string | null,
    loadRef: string,
  ): Promise<TransporterOffer | null> {
    const recipient = await this.dataSource
      .getRepository(LoadRecipientEntity)
      .findOne({ where: { id: recipientId }, relations: { posting: true } });
    if (!recipient || recipient.recipientType !== 'transporter' || !recipient.transporterId)
      return null;
    const load = await this.dataSource
      .getRepository(LoadEntity)
      .findOneBy(
        loadId
          ? { id: loadId, tenantId: recipient.tenantId, postingId: recipient.postingId }
          : { code: loadRef, tenantId: recipient.tenantId, postingId: recipient.postingId },
      );
    return load ? toOffer(recipient, load) : null;
  }

  latestOfferAnswer(loadId: string, recipientId: string): Promise<InboundResolution | null> {
    return this.inboundRepository.findLatestOfferAnswer(loadId, recipientId);
  }
}
