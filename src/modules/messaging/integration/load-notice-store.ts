import { DataSource, In, IsNull, MoreThanOrEqual, Not } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { DriverEntity } from '../../driver/entities/driver.entity';
import { DriverSessionEntity } from '../../driver/entities/driver-session.entity';
import { LoadBidEntity } from '../../loads/bids/load-bid.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { LoadPostingEntity } from '../../loads/load-posting/entities/load-posting.entity';
import { PostAddress } from '../../loads/load-posting/utils/load-posting.types';
import { LoadMemoEntity } from '../../loads/memo/load-memo.entity';
import { LsOriginalPodEntity } from '../../loadsmart-ops/entities/ls-original-pod.entity';
import { LsPartnerEntity } from '../../loadsmart-ops/entities/ls-partner.entity';
import { LsPartnerBidEntity } from '../../loadsmart-ops/entities/ls-partner-bid.entity';
import { LsPartnerPaymentEntity } from '../../loadsmart-ops/entities/ls-partner-payment.entity';
import { LsSourcingEntity } from '../../loadsmart-ops/entities/ls-sourcing.entity';
import { tripAmount } from '../../loadsmart-ops/loadsmart-rules';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import {
  LIVE_BID_STATUS,
  LOADSMART_WON_SOURCING_STATUS,
  ORIGINAL_POD_CHASED_STATUSES,
  TRUCK_LABEL_FALLBACK,
} from '../messaging.constants';
import { TemplateKey } from '../templates/template-registry';
import { TypeormShipperNames } from './shipper-names';
import { storedPhoneVariantsOf } from './phone-variants';
import {
  AwaitedOriginalPod,
  LastSent,
  LiveBidSummary,
  LoadNoticeStore,
  LoadPartner,
  NoticeContact,
  NoticeLoad,
  NoticeRecipientKind,
} from './load-notices.interface';

/** "Gurugram 122001" — the area (or city) and PIN, as on the offers. */
function placeLabelOf(address: PostAddress): string {
  const place = address.areaLocality || address.city || address.label;
  return address.pinCode ? `${place} ${address.pinCode}` : place;
}

function mapsQueryOf(address: PostAddress): string {
  if (address.latitude !== null && address.longitude !== null) {
    return `${address.latitude},${address.longitude}`;
  }
  return [address.addressLine1, address.areaLocality, address.city, address.pinCode]
    .filter(Boolean)
    .join(', ');
}

/** The reads behind the load notices, through TypeORM (no raw SQL). */
export class TypeormLoadNoticeStore implements LoadNoticeStore {
  private readonly shipperNames: TypeormShipperNames;

  constructor(private readonly dataSource: DataSource) {
    this.shipperNames = new TypeormShipperNames(dataSource);
  }

  async findLoad(tenantId: string, loadId: string): Promise<NoticeLoad | null> {
    const load = await this.dataSource
      .getRepository(LoadEntity)
      .findOneBy({ id: loadId, tenantId });
    if (!load) return null;
    const posting = load.postingId
      ? await this.dataSource
          .getRepository(LoadPostingEntity)
          .findOneBy({ id: load.postingId, tenantId })
      : null;
    if (!posting) {
      return {
        load,
        origin: load.code,
        destination: load.code,
        destinationQuery: '',
        reportingAt: null,
        truckLabel: TRUCK_LABEL_FALLBACK,
      };
    }
    return {
      load,
      origin: placeLabelOf(posting.pickupAddress),
      destination: posting.dropAddress.city || placeLabelOf(posting.dropAddress),
      destinationQuery: mapsQueryOf(posting.dropAddress),
      reportingAt: posting.pickupAt,
      truckLabel: posting.truckLengthFt ? `${posting.truckLengthFt} ft` : TRUCK_LABEL_FALLBACK,
    };
  }

  async findTransporter(tenantId: string, transporterId: string): Promise<NoticeContact | null> {
    const transporter = await this.dataSource
      .getRepository(TransporterEntity)
      .findOneBy({ id: transporterId, tenantId });
    return transporter
      ? { id: transporter.id, name: transporter.name, phone: transporter.phone }
      : null;
  }

  async findLoadPartner(loadId: string): Promise<LoadPartner | null> {
    const sourcing = await this.dataSource.getRepository(LsSourcingEntity).findOne({
      where: { loadId, status: LOADSMART_WON_SOURCING_STATUS },
      relations: { load: true },
    });
    if (!sourcing?.partnerId) return null;
    const partner = await this.dataSource
      .getRepository(LsPartnerEntity)
      .findOneBy({ id: sourcing.partnerId });
    if (!partner) return null;
    return {
      contact: { id: partner.id, name: partner.name, phone: partner.phone },
      // The trip total — brokers quote the whole trip, never per tonne.
      partnerRate: sourcing.partnerRate
        ? String(
            tripAmount(
              Number(sourcing.partnerRate),
              sourcing.load.freightType,
              Number(sourcing.load.plannedCapacityTonnes),
            ),
          )
        : null,
    };
  }

  async findUser(userId: string) {
    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ id: userId, deletedAt: IsNull() });
    return user
      ? { id: user.id, name: user.fullName, phone: user.phoneNumber, tenantId: user.tenantId }
      : null;
  }

  shipperName(tenantId: string): Promise<string | null> {
    return this.shipperNames.nameOf(tenantId);
  }

  findBid(tenantId: string, bidId: string): Promise<LoadBidEntity | null> {
    return this.dataSource.getRepository(LoadBidEntity).findOneBy({ id: bidId, tenantId });
  }

  findMemo(tenantId: string, memoId: string): Promise<LoadMemoEntity | null> {
    return this.dataSource.getRepository(LoadMemoEntity).findOneBy({ id: memoId, tenantId });
  }

  findPartnerPayment(partnerPaymentId: string): Promise<LsPartnerPaymentEntity | null> {
    return this.dataSource
      .getRepository(LsPartnerPaymentEntity)
      .findOneBy({ id: partnerPaymentId });
  }

  findLoadPayment(tenantId: string, paymentId: string): Promise<LoadPaymentEntity | null> {
    return this.dataSource.getRepository(LoadPaymentEntity).findOneBy({ id: paymentId, tenantId });
  }

  async driverHasApp(phone: string): Promise<boolean> {
    const drivers = await this.dataSource
      .getRepository(DriverEntity)
      .find({ where: { phoneNumber: In(storedPhoneVariantsOf(phone)) }, select: { id: true } });
    if (drivers.length === 0) return false;
    return this.dataSource.getRepository(DriverSessionEntity).exists({
      where: {
        driverId: In(drivers.map((driver) => driver.id)),
        fcmToken: Not(IsNull()),
        revokedAt: IsNull(),
        expiresAt: MoreThanOrEqual(new Date()),
      },
    });
  }

  hasSent(
    loadId: string,
    templateKey: TemplateKey,
    recipientRefId: string,
    since?: Date,
  ): Promise<boolean> {
    return this.dataSource.getRepository(MessageLogEntity).exists({
      where: {
        loadId,
        templateKey,
        recipientRefId,
        channel: 'whatsapp',
        status: Not('suppressed'),
        ...(since ? { createdAt: MoreThanOrEqual(since) } : {}),
      },
    });
  }

  async listAwaitedOriginalPods(): Promise<AwaitedOriginalPod[]> {
    const rows = await this.dataSource.getRepository(LsOriginalPodEntity).find({
      where: { status: In([...ORIGINAL_POD_CHASED_STATUSES]) },
      select: { tenantId: true, loadId: true, deliveredOn: true },
    });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      loadId: row.loadId,
      deliveredOn: row.deliveredOn,
    }));
  }

  partnerRepliedSince(loadId: string, partnerId: string, since: Date): Promise<boolean> {
    return this.dataSource.getRepository(WhatsappInboundEntity).exists({
      where: { loadId, recipientRefId: partnerId, receivedAt: MoreThanOrEqual(since) },
    });
  }

  async liveBidSummary(tenantId: string, loadId: string): Promise<LiveBidSummary> {
    const bids = await this.dataSource.getRepository(LoadBidEntity).find({
      where: { tenantId, loadId, status: LIVE_BID_STATUS },
      select: { id: true, rate: true },
    });
    const rates = bids.map((bid) => Number(bid.rate)).filter((rate) => Number.isFinite(rate));
    return { count: bids.length, bestRate: rates.length ? String(Math.min(...rates)) : null };
  }

  async sentVariables(
    loadId: string,
    templateKey: TemplateKey,
    recipientRefId: string,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.dataSource.getRepository(MessageLogEntity).find({
      where: {
        loadId,
        templateKey,
        recipientRefId,
        channel: 'whatsapp',
        status: Not('suppressed'),
      },
      select: { id: true, variables: true },
    });
    return rows.map((row) => row.variables ?? {});
  }

  async lastSent(
    loadId: string,
    templateKey: TemplateKey,
    recipientRefId: string,
  ): Promise<LastSent | null> {
    const row = await this.dataSource.getRepository(MessageLogEntity).findOne({
      where: {
        loadId,
        templateKey,
        recipientRefId,
        channel: 'whatsapp',
        status: Not('suppressed'),
      },
      order: { createdAt: 'DESC' },
      select: { id: true, createdAt: true, variables: true },
    });
    return row ? { createdAt: row.createdAt, variables: row.variables } : null;
  }

  async listTransporterBidders(tenantId: string, loadId: string): Promise<NoticeContact[]> {
    const bids = await this.dataSource.getRepository(LoadBidEntity).find({
      where: { tenantId, loadId, source: 'transporter' },
      select: { id: true, transporterId: true },
    });
    const ids = [...new Set(bids.map((bid) => bid.transporterId).filter(Boolean))] as string[];
    if (ids.length === 0) return [];
    const transporters = await this.dataSource
      .getRepository(TransporterEntity)
      .find({ where: { tenantId, id: In(ids) } });
    return transporters.map((transporter) => ({
      id: transporter.id,
      name: transporter.name,
      phone: transporter.phone,
    }));
  }

  async listPartnerBidders(loadId: string): Promise<NoticeContact[]> {
    const sourcing = await this.dataSource
      .getRepository(LsSourcingEntity)
      .findOne({ where: { loadId }, select: { id: true } });
    if (!sourcing) return [];
    const bids = await this.dataSource.getRepository(LsPartnerBidEntity).find({
      where: { sourcingId: sourcing.id },
      select: { id: true, partnerId: true },
    });
    const ids = [...new Set(bids.map((bid) => bid.partnerId))];
    if (ids.length === 0) return [];
    const partners = await this.dataSource
      .getRepository(LsPartnerEntity)
      .find({ where: { id: In(ids) } });
    return partners.map((partner) => ({
      id: partner.id,
      name: partner.name,
      phone: partner.phone,
    }));
  }

  async listWhatsappRecipients(
    loadId: string,
    kinds: readonly NoticeRecipientKind[],
  ): Promise<(NoticeContact & { kind: NoticeRecipientKind })[]> {
    if (kinds.length === 0) return [];
    const rows = await this.dataSource.getRepository(MessageLogEntity).find({
      where: {
        loadId,
        channel: 'whatsapp',
        recipientKind: In([...kinds]),
        recipientRefId: Not(IsNull()),
        status: Not('suppressed'),
      },
      select: { recipientKind: true, recipientRefId: true, recipientName: true, address: true },
      order: { createdAt: 'DESC' },
    });
    // Latest row first, so each recipient is reached at the number we last used for them.
    const seen = new Map<string, NoticeContact & { kind: NoticeRecipientKind }>();
    for (const row of rows) {
      const key = `${row.recipientKind}:${row.recipientRefId}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        kind: row.recipientKind as NoticeRecipientKind,
        id: row.recipientRefId!,
        name: row.recipientName,
        phone: row.address,
      });
    }
    return [...seen.values()];
  }
}
