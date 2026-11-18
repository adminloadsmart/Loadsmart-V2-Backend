import { ONE_DAY_MS } from '../../../shared/utils/date-filter';
import { startOfIstDate } from '../../../shared/utils/ist-time';
import { daysBetween, originalPodPenalty } from '../../loadsmart-ops/billing-rules';
import { isLoadsmartLoad } from '../../loads/utils/load-stages';
import {
  LoadPartyNotice,
  LoadPartyNotifier,
} from '../../loads/utils/load-party-notifier.interface';
import { istDateOf } from '../../loads/verification/verification-rules';
import { LoadEvent, LoadEventNotifier } from '../../notifications/notifications.interface';
import { SettingsReader } from '../../settings/settings.types';
import {
  BIDS_ROLLUP_INTERVAL_MS,
  FOLLOW_UP_DEDUPE_WINDOW_MS,
  MESSAGING_ACTORS,
  ORIGINAL_POD_PENALTY_REPEAT_DAYS,
  ORIGINAL_POD_REMINDER_DAYS_BEFORE_DUE,
  PARTNER_PAYMENT_HEADS,
  POD_ISSUE_LABELS,
  TEMPLATE_VALUE_NOT_GIVEN,
  WHATSAPP_ANSWERABLE_LOAD_STATUSES,
} from '../messaging.constants';
import { OutboundMessageService, OutboundRecipient } from '../outbound/outbound-message.service';
import { TemplateKey } from '../templates/template-registry';
import {
  BidsRollupJob,
  FileLinker,
  LoadNoticeStore,
  NoticeContact,
  NoticeLoad,
  NoticeSendOptions,
  RollupScheduler,
} from './load-notices.interface';
import { formatDueDate, formatReportingTime, formatRupees } from './offer-formatting';

const valueOr = (value: string | null | undefined): string => value || TEMPLATE_VALUE_NOT_GIVEN;

/** The IST calendar day `days` after a YYYY-MM-DD date (its start), for formatting. */
function dateAfter(isoDate: string, days: number): Date {
  return new Date(startOfIstDate(isoDate).getTime() + days * ONE_DAY_MS);
}

function fileNameOf(fileKey: string, label: string): string {
  const extension = /\.[a-z0-9]+$/i.exec(fileKey)?.[0] ?? '';
  return `${label}${extension}`;
}

/**
 * The load-flow WhatsApp notices of the catalog (LS_N_0067, 0069, 0103, 0107, 0109, 0110, 0112,
 * 0114–0117, 0121–0124, 0126, 0130): bids and the load memo to the shipper, and confirmations,
 * "not chosen", papers, payments and the original POD to the Loadsmart partner, the shipper's own
 * transporter or the driver.
 *
 * Stage moves arrive as load events (the load-event notifier, beside the in-app notifications);
 * memo, payments and the original POD as party notices from the services that record them; the
 * original POD reminders from a daily job. Every send is a template through the outbound service
 * (logged in message_log first, channel rules applied). Nothing here throws: a WhatsApp problem
 * must not fail the load step.
 */
export class LoadPartyWhatsapp {
  constructor(
    private readonly store: LoadNoticeStore,
    private readonly outbound: Pick<OutboundMessageService, 'sendTemplate'>,
    private readonly settings: SettingsReader,
    private readonly linkFile: FileLinker,
    private readonly scheduleRollup: RollupScheduler,
    private readonly logger: Pick<Console, 'error' | 'warn'> = console,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Load events (LoadStageService / LoadService / LoadBidService) → the notices they trigger. */
  readonly onLoadEvent: LoadEventNotifier = async (event: LoadEvent) => {
    try {
      await this.handleLoadEvent(event);
    } catch (error) {
      this.logger.error(`[messaging] load notice for ${event.kind} failed`, error);
    }
  };

  /** Memo, payments and the original POD (LoadMemoService, payments, Loadsmart ops). */
  readonly notify: LoadPartyNotifier = async (notice: LoadPartyNotice) => {
    try {
      await this.handleNotice(notice);
    } catch (error) {
      this.logger.error(`[messaging] load notice for ${notice.kind} failed`, error);
    }
  };

  /**
   * The daily original POD follow-up on Loadsmart loads: LS_N_0115 again on the reminder days
   * unless the partner has replied, LS_N_0116 from the day after the due date and every 7 days
   * after, while the original is not sent. Returns how many went out.
   */
  async runOriginalPodFollowUps(): Promise<number> {
    const now = this.now();
    const today = istDateOf(now);
    const since = new Date(now.getTime() - FOLLOW_UP_DEDUPE_WINDOW_MS);
    let sent = 0;
    for (const pod of await this.store.listAwaitedOriginalPods()) {
      try {
        const notice = await this.store.findLoad(pod.tenantId, pod.loadId);
        if (!notice || !isLoadsmartLoad(notice.load)) continue;
        const partner = await this.store.findLoadPartner(pod.loadId);
        if (!partner) continue;
        const { values } = await this.settings.forLoad(notice.load);
        const dueDays = values.originalPodDueDays;
        const days = daysBetween(pod.deliveredOn, today);
        const recipient = this.partnerRecipient(partner.contact);

        const penaltyDay =
          days > dueDays && (days - dueDays - 1) % ORIGINAL_POD_PENALTY_REPEAT_DAYS === 0;
        if (penaltyDay) {
          if (await this.store.hasSent(pod.loadId, 'LS_N_0116', partner.contact.id, since))
            continue;
          const { penalty } = originalPodPenalty(
            pod.deliveredOn,
            today,
            dueDays,
            values.originalPodPenaltyPerDay,
          );
          await this.send(notice, 'LS_N_0116', recipient, {
            load_id: notice.load.code,
            penalty_amount: formatRupees(String(penalty)),
          });
          sent += 1;
          continue;
        }

        const reminderDays = ORIGINAL_POD_REMINDER_DAYS_BEFORE_DUE.map(
          (daysBefore) => dueDays - daysBefore,
        ).filter((day) => day > 0);
        if (!reminderDays.includes(days)) continue;
        if (await this.store.hasSent(pod.loadId, 'LS_N_0115', partner.contact.id, since)) continue;
        const deliveredFrom = startOfIstDate(pod.deliveredOn);
        if (await this.store.partnerRepliedSince(pod.loadId, partner.contact.id, deliveredFrom)) {
          continue;
        }
        await this.send(notice, 'LS_N_0115', recipient, {
          load_id: notice.load.code,
          pod_due_date: formatDueDate(dateAfter(pod.deliveredOn, dueDays)),
        });
        sent += 1;
      } catch (error) {
        this.logger.error(
          `[messaging] original POD follow-up for load ${pod.loadId} failed`,
          error,
        );
      }
    }
    return sent;
  }

  /** The delayed LS_N_0103 roll-up (whatsapp-schedules queue). Never throws, so a failed run
   *  doesn't keep the load's job id. */
  async runBidsRollup(job: BidsRollupJob): Promise<void> {
    try {
      await this.bidsReceived(job.tenantId, job.loadId);
    } catch (error) {
      this.logger.error(`[messaging] bids roll-up for load ${job.loadId} failed`, error);
    }
  }

  // ------------------------------------------------------------------ load events

  private async handleLoadEvent(event: LoadEvent): Promise<void> {
    switch (event.kind) {
      case 'stage_changed':
        if (event.to === 'truck_assigned') return this.memoAccepted(event.tenantId, event.loadId);
        if (event.to === 'bids_received') return this.indentAccepted(event.tenantId, event.loadId);
        if (event.to === 'loaded') return this.papersApproved(event.tenantId, event.loadId);
        return;
      case 'assigned':
        return this.bidAccepted(event.tenantId, event.loadId);
      case 'pod_uploaded':
        return this.podUploaded(event.tenantId, event.loadId);
      case 'pod_reviewed':
        if (event.decision === 'accepted') return this.podApproved(event.tenantId, event.loadId);
        return;
      default:
        return;
    }
  }

  /** LS_N_0107 (Loadsmart's bid, to the partner behind it) / LS_N_0121 (a transporter's bid). */
  private async bidAccepted(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const load = notice?.load;
    if (!notice || !load?.awardedBidId || load.postingType !== 'market_fleet') return;
    const bid = await this.store.findBid(tenantId, load.awardedBidId);
    if (!bid) return;
    if (bid.source === 'loadsmart') {
      const partner = await this.store.findLoadPartner(loadId);
      if (!partner) return;
      await this.send(
        notice,
        'LS_N_0107',
        this.partnerRecipient(partner.contact),
        {
          rate: formatRupees(partner.partnerRate),
          from_area: notice.origin,
          to_area: notice.destination,
        },
        { once: true },
      );
      return;
    }
    await this.rateAcceptedToTransporter(notice, bid.rate);
  }

  /** LS_N_0121 on an indent: the contracted transporter accepted it (Bids received, indent). */
  private async indentAccepted(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    if (!notice || notice.load.postingType !== 'indent') return;
    await this.rateAcceptedToTransporter(notice, notice.load.freightValue);
  }

  private async rateAcceptedToTransporter(notice: NoticeLoad, rate: string | null): Promise<void> {
    const transporter = await this.transporterOf(notice);
    if (!transporter) return;
    await this.send(
      notice,
      'LS_N_0121',
      this.transporterRecipient(transporter),
      {
        rate: formatRupees(rate),
        origin: notice.origin,
        destination: notice.destination,
        shipper_name: await this.shipperNameOf(notice),
      },
      { once: true },
    );
  }

  /** LS_N_0110 (partner, Loadsmart load) / LS_N_0123 (own transporter, indent): memo accepted. */
  private async memoAccepted(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    if (!notice || notice.load.postingType === 'own_fleet') return;
    const { load } = notice;
    const reportingTime = formatReportingTime(notice.reportingAt);
    if (isLoadsmartLoad(load)) {
      const partner = await this.store.findLoadPartner(loadId);
      if (!partner) return;
      await this.send(
        notice,
        'LS_N_0110',
        this.partnerRecipient(partner.contact),
        {
          load_id: load.code,
          from_area: notice.origin,
          to_area: notice.destination,
          vehicle_no: valueOr(load.vehicleNumber),
          reporting_time: reportingTime,
          driver_name: valueOr(load.driverName),
          load_uuid: load.id,
        },
        { once: true },
      );
      // LS_N_0109 to every other broker who bid on the load.
      for (const bidder of await this.store.listPartnerBidders(loadId)) {
        if (bidder.id === partner.contact.id) continue;
        await this.send(
          notice,
          'LS_N_0109',
          this.partnerRecipient(bidder),
          { from_area: notice.origin, to_area: notice.destination },
          { once: true },
        );
      }
      return;
    }
    const transporter = await this.transporterOf(notice);
    if (!transporter) return;
    await this.notChosenTransporters(notice, transporter.id);
    await this.send(
      notice,
      'LS_N_0123',
      this.transporterRecipient(transporter),
      {
        shipper_name: await this.shipperNameOf(notice),
        vehicle_no: valueOr(load.vehicleNumber),
        origin: notice.origin,
        destination: notice.destination,
        reporting_time: reportingTime,
        load_uuid: load.id,
      },
      { once: true },
    );
  }

  /** LS_N_0122 to the shipper's other transporters who bid (an indent has none). */
  private async notChosenTransporters(notice: NoticeLoad, chosenId: string): Promise<void> {
    const bidders = await this.store.listTransporterBidders(notice.load.tenantId, notice.load.id);
    const others = bidders.filter((bidder) => bidder.id !== chosenId);
    if (others.length === 0) return;
    const shipperName = await this.shipperNameOf(notice);
    for (const bidder of others) {
      await this.send(
        notice,
        'LS_N_0122',
        this.transporterRecipient(bidder),
        { shipper_name: shipperName, origin: notice.origin, destination: notice.destination },
        { once: true },
      );
    }
  }

  /** LS_N_0130: Tracking approved the loading papers on a Loadsmart load — the driver may go.
   *  WhatsApp only when the driver isn't on the driver app (the channel rules hold it otherwise). */
  private async papersApproved(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const load = notice?.load;
    if (!notice || !load || !isLoadsmartLoad(load) || !load.driverNumber) return;
    await this.send(
      notice,
      'LS_N_0130',
      {
        kind: 'driver',
        refId: load.driverId ?? load.driverNumber,
        name: load.driverName,
        phone: load.driverNumber,
      },
      {
        vehicle_no: valueOr(load.vehicleNumber),
        destination: notice.destination,
        destination_query: notice.destinationQuery,
      },
      { once: true, driverHasApp: await this.store.driverHasApp(load.driverNumber) },
    );
  }

  /** LS_N_0124: the shipper's side uploaded the POD (own transporter, indent). */
  private async podUploaded(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const load = notice?.load;
    if (!notice || !load || load.postingType === 'own_fleet' || isLoadsmartLoad(load)) return;
    const transporter = await this.transporterOf(notice);
    if (!transporter) return;
    await this.send(
      notice,
      'LS_N_0124',
      this.transporterRecipient(transporter),
      {
        vehicle_no: valueOr(load.vehicleNumber),
        origin: notice.origin,
        destination: notice.destination,
        shipper_name: await this.shipperNameOf(notice),
      },
      { once: true },
    );
  }

  /** Tracking approved the POD on a Loadsmart load: LS_N_0114 when an issue is noted (balance on
   *  hold), then LS_N_0115 (send the original POD by the due date). */
  private async podApproved(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const load = notice?.load;
    if (!notice || !load || !isLoadsmartLoad(load)) return;
    const partner = await this.store.findLoadPartner(loadId);
    if (!partner) return;
    const recipient = this.partnerRecipient(partner.contact);
    const issue = load.shortageOrDamage;
    if (issue && issue !== 'none') {
      await this.send(
        notice,
        'LS_N_0114',
        recipient,
        { load_id: load.code, issue_type: POD_ISSUE_LABELS[issue] ?? issue },
        { once: true },
      );
    }
    const { values } = await this.settings.forLoad(load);
    const deliveredOn = istDateOf(load.deliveredAt ?? this.now());
    await this.send(
      notice,
      'LS_N_0115',
      recipient,
      {
        load_id: load.code,
        pod_due_date: formatDueDate(dateAfter(deliveredOn, values.originalPodDueDays)),
      },
      { once: true },
    );
  }

  // ------------------------------------------------------------------ party notices

  private async handleNotice(notice: LoadPartyNotice): Promise<void> {
    switch (notice.kind) {
      case 'memo_sent':
        return this.memoSent(notice.tenantId, notice.loadId, notice.memoId);
      case 'partner_paid':
        return this.partnerPaid(notice.tenantId, notice.loadId, notice.partnerPaymentId);
      case 'transporter_payment_recorded':
        return this.transporterPaid(notice.tenantId, notice.loadId, notice.paymentId);
      case 'original_pod_received':
        return this.originalPodReceived(notice.tenantId, notice.loadId);
      case 'bid_received':
        return this.bidsReceived(notice.tenantId, notice.loadId);
      case 'loadsmart_bid_sent':
        return this.loadsmartBidSent(notice.tenantId, notice.loadId, notice.bidId);
    }
  }

  /**
   * LS_N_0103 to the shipper user who posted the load: the first bid at once, then at most one
   * roll-up per 30 minutes — a bid inside the interval queues the roll-up for its end, and the
   * roll-up goes only if the count changed.
   */
  private async bidsReceived(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const load = notice?.load;
    if (!notice || !load || load.postingType !== 'market_fleet' || load.awardedBidId) return;
    if (!(WHATSAPP_ANSWERABLE_LOAD_STATUSES as readonly string[]).includes(load.status)) return;
    const user = await this.postedBy(notice);
    if (!user) return;
    const last = await this.store.lastSent(loadId, 'LS_N_0103', user.id);
    const elapsed = last ? this.now().getTime() - last.createdAt.getTime() : Infinity;
    if (elapsed < BIDS_ROLLUP_INTERVAL_MS) {
      await this.scheduleRollup({ tenantId, loadId }, BIDS_ROLLUP_INTERVAL_MS - elapsed);
      return;
    }
    const summary = await this.store.liveBidSummary(tenantId, loadId);
    if (summary.count === 0) return;
    if (last && String(last.variables?.bid_count) === String(summary.count)) return;
    await this.send(notice, 'LS_N_0103', this.shipperRecipient(user), {
      origin: notice.origin,
      destination: notice.destination,
      bid_count: String(summary.count),
      best_rate: formatRupees(summary.bestRate),
      load_uuid: load.id,
    });
  }

  /** LS_N_0067: Loadsmart's bid (new or revised) to the shipper user who posted the load; Accept,
   *  Counter and Reject on it act on the bid as that user (ShipperReplyActions). */
  private async loadsmartBidSent(tenantId: string, loadId: string, bidId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const bid = await this.store.findBid(tenantId, bidId);
    if (!notice || !bid || bid.source !== 'loadsmart') return;
    const user = await this.postedBy(notice);
    if (!user) return;
    await this.send(notice, 'LS_N_0067', this.shipperRecipient(user), {
      origin: notice.origin,
      destination: notice.destination,
      truck_type: notice.truckLabel,
      reporting_time: formatReportingTime(notice.reportingAt),
      price: formatRupees(bid.rate),
    });
  }

  /** The shipper user who posted the load, in the load's own tenant. */
  private async postedBy(notice: NoticeLoad): Promise<NoticeContact | null> {
    if (!notice.load.createdBy) return null;
    const user = await this.store.findUser(notice.load.createdBy);
    if (!user?.phone || user.tenantId !== notice.load.tenantId) return null;
    return user;
  }

  /** LS_N_0069: the load memo to the shipper user who posted the load; "Accept memo" on it
   *  accepts it as that user (ShipperReplyActions). A new version is a new message. */
  private async memoSent(tenantId: string, loadId: string, memoId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const memo = await this.store.findMemo(tenantId, memoId);
    if (!notice || !memo || !notice.load.createdBy) return;
    const user = await this.store.findUser(notice.load.createdBy);
    if (!user?.phone || user.tenantId !== tenantId) return;
    await this.send(
      notice,
      'LS_N_0069',
      { kind: 'shipper_user', refId: user.id, name: user.name, phone: user.phone },
      {
        vehicle_no: valueOr(memo.vehicleNumber),
        driver_name: valueOr(memo.driverName),
        price: formatRupees(memo.freightValue),
        origin: notice.origin,
        destination: notice.destination,
        expiry_time: formatReportingTime(memo.expiresAt),
        load_uuid: notice.load.id,
      },
    );
  }

  /** LS_N_0112: Loadsmart paid its partner — the advance or the balance, with the proof. */
  private async partnerPaid(
    tenantId: string,
    loadId: string,
    partnerPaymentId: string,
  ): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const payment = await this.store.findPartnerPayment(partnerPaymentId);
    const partner = await this.store.findLoadPartner(loadId);
    if (!notice || !payment || !partner) return;
    const head = PARTNER_PAYMENT_HEADS[payment.paymentType];
    const headerDocument = await this.proofDocument(
      payment.proofFileKey,
      `${notice.load.code} ${head} payment proof`,
    );
    if (!headerDocument) {
      this.logger.warn(
        `[messaging] LS_N_0112 not sent for ${notice.load.code}: the payment has no proof to attach`,
      );
      return;
    }
    await this.send(
      notice,
      'LS_N_0112',
      this.partnerRecipient(partner.contact),
      {
        load_id: notice.load.code,
        vehicle_no: valueOr(notice.load.vehicleNumber),
        payment_head: head,
        net_amount: formatRupees(payment.netAmount),
        tds_amount: formatRupees(payment.tdsAmount),
        utr: valueOr(payment.utrReference),
      },
      { headerDocument },
    );
  }

  /** LS_N_0126: the shipper recorded a payment to its own transporter, with the proof. */
  private async transporterPaid(
    tenantId: string,
    loadId: string,
    paymentId: string,
  ): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const payment = await this.store.findLoadPayment(tenantId, paymentId);
    if (!notice || !payment?.transporterId || isLoadsmartLoad(notice.load)) return;
    const transporter = await this.store.findTransporter(tenantId, payment.transporterId);
    if (!transporter) return;
    const headerDocument = await this.proofDocument(
      payment.proofFileKey,
      `${notice.load.code} payment proof`,
    );
    if (!headerDocument) {
      this.logger.warn(
        `[messaging] LS_N_0126 not sent for ${notice.load.code}: the payment has no proof to attach`,
      );
      return;
    }
    await this.send(
      notice,
      'LS_N_0126',
      this.transporterRecipient(transporter),
      {
        shipper_name: await this.shipperNameOf(notice),
        amount: formatRupees(payment.amount),
        vehicle_no: valueOr(notice.load.vehicleNumber),
        utr: valueOr(payment.utrReference),
      },
      { headerDocument },
    );
  }

  /** LS_N_0117: Payables marked the original POD received. */
  private async originalPodReceived(tenantId: string, loadId: string): Promise<void> {
    const notice = await this.store.findLoad(tenantId, loadId);
    const partner = await this.store.findLoadPartner(loadId);
    if (!notice || !partner) return;
    await this.send(
      notice,
      'LS_N_0117',
      this.partnerRecipient(partner.contact),
      { load_id: notice.load.code },
      { once: true },
    );
  }

  // ------------------------------------------------------------------ helpers

  private async send(
    notice: NoticeLoad,
    templateKey: TemplateKey,
    recipient: OutboundRecipient,
    variables: Record<string, string>,
    options: NoticeSendOptions = {},
  ): Promise<void> {
    const { load } = notice;
    if (
      options.once &&
      recipient.refId &&
      (await this.store.hasSent(load.id, templateKey, recipient.refId))
    ) {
      return;
    }
    await this.outbound.sendTemplate({
      tenantId: load.tenantId,
      loadId: load.id,
      loadRef: load.code,
      recipient,
      templateKey,
      variables,
      actor: MESSAGING_ACTORS.loadNotices,
      ...(options.headerDocument ? { headerDocument: options.headerDocument } : {}),
      ...(options.driverHasApp !== undefined ? { driverHasApp: options.driverHasApp } : {}),
    });
  }

  private async proofDocument(
    fileKey: string | null,
    label: string,
  ): Promise<{ link: string; filename: string } | null> {
    if (!fileKey) return null;
    return { link: await this.linkFile(fileKey), filename: fileNameOf(fileKey, label) };
  }

  private async transporterOf(notice: NoticeLoad): Promise<NoticeContact | null> {
    const { load } = notice;
    return load.transporterId
      ? this.store.findTransporter(load.tenantId, load.transporterId)
      : null;
  }

  private async shipperNameOf(notice: NoticeLoad): Promise<string> {
    return valueOr(await this.store.shipperName(notice.load.tenantId));
  }

  private shipperRecipient(user: NoticeContact): OutboundRecipient {
    return { kind: 'shipper_user', refId: user.id, name: user.name, phone: user.phone };
  }

  private partnerRecipient(partner: NoticeContact): OutboundRecipient {
    return { kind: 'partner', refId: partner.id, name: partner.name, phone: partner.phone };
  }

  private transporterRecipient(transporter: NoticeContact): OutboundRecipient {
    return {
      kind: 'transporter',
      refId: transporter.id,
      name: transporter.name,
      phone: transporter.phone,
    };
  }
}
