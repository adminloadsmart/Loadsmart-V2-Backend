import { In } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadStageService } from '../loads/core/load-stage.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { istDateOf } from '../loads/verification/verification-rules';
import { SettingsReader } from '../settings/settings.types';
import { LsOriginalPodEntity } from './entities/ls-original-pod.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import {
  DEFAULT_TDS_PERCENT,
  INVOICE_SETTLED_STATUSES,
  ORIGINAL_POD_STATUSES,
  OriginalPodStatus,
} from './loadsmart.types';
import { carrierBalance, daysBetween, originalPodPenalty } from './billing-rules';
import { LsServiceBase } from './ls-base';
import { UtrInput } from './loadsmart.interface';

export interface OriginalPodUpdateInput {
  status?: OriginalPodStatus;
  courierName?: string;
  docketNumber?: string;
  holder?: string;
}

export interface OriginalPodFilter {
  status?: OriginalPodStatus[];
  pastDue?: boolean;
  /** Shippers billed on the original POD. */
  shipperNeedsOriginal?: boolean;
}

/**
 * Payables (Y01, Y03): follows up the original POD until it is filed at Mohali, raises the
 * carrier's balance on it for Super Admin, and records the UTR once paid. "Never on the image.
 * With damage noted, waits for the shipper's payment." Shipper rates are never shown here. No
 * WhatsApp payment advice is sent from this build.
 */
export class LsPayablesService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly loadRepository: LoadRepository,
    private readonly stageService: LoadStageService,
    private readonly settings: SettingsReader,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  /** Stage hook: a delivered Loadsmart load joins the original POD tracker. */
  async openTracker(load: LoadEntity): Promise<void> {
    if (await this.repository.originalPods.findOneBy({ loadId: load.id })) return;
    const sourcing = await this.repository.findSourcingByLoad(load.id);
    if (!sourcing) return;
    await this.repository.originalPods.save(
      this.repository.originalPods.create({
        tenantId: load.tenantId,
        loadId: load.id,
        sourcingId: sourcing.id,
        deliveredOn: istDateOf(load.deliveredAt ?? this.now()),
      }),
    );
  }

  // --- Original POD tracker (Y03) ------------------------------------------------------------

  async listOriginalPods(filter: OriginalPodFilter) {
    const rows = await this.repository.originalPods.find({
      where: filter.status?.length
        ? { status: In(filter.status) }
        : { status: In(ORIGINAL_POD_STATUSES.filter((status) => status !== 'received_filed')) },
      order: { deliveredOn: 'ASC' },
      take: 500,
    });
    const today = istDateOf(this.now());
    const views = [];
    for (const row of rows) {
      const sourcing = await this.repository.findSourcingByLoad(row.loadId);
      if (!sourcing) continue;
      const view = await this.trackerView(row, sourcing, today);
      if (filter.pastDue && view.daysLate === 0) continue;
      if (filter.shipperNeedsOriginal && !view.shipperNeedsOriginal) continue;
      views.push(view);
    }
    return views;
  }

  async updateOriginalPod(actorId: string, loadId: string, input: OriginalPodUpdateInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const row = await this.assertTracker(loadId);
      if (row.status === 'received_filed') {
        throw new ConflictError('The original POD is already received and filed');
      }
      const now = this.now();
      const status = input.status ?? row.status;
      if (status === 'dispatched' && !(input.docketNumber ?? row.docketNumber)) {
        throw new ValidationError('Add the courier docket number');
      }
      const fields: Partial<LsOriginalPodEntity> = {
        status,
        ...(input.courierName !== undefined ? { courierName: input.courierName } : {}),
        ...(input.docketNumber !== undefined ? { docketNumber: input.docketNumber } : {}),
        ...(input.holder !== undefined ? { holder: input.holder } : {}),
        ...(status === 'dispatched' && !row.dispatchedAt ? { dispatchedAt: now } : {}),
        ...(status === 'not_traceable' ? { indemnityBondRequired: true } : {}),
        updatedBy: actorId,
      };
      if (status === 'received_filed') {
        if (!sourcing.load.deliveredAt || sourcing.load.podStatus !== 'accepted') {
          throw new ConflictError('The original POD follows a decided POD');
        }
        const { penalty } = await this.penaltyFor(row, sourcing, istDateOf(now));
        Object.assign(fields, { receivedAt: now, filedAt: now, penaltyAmount: String(penalty) });
        await this.loadRepository.update(sourcing.tenantId, loadId, {
          originalPodReceivedAt: now,
          updatedBy: actorId,
        });
      }
      await this.repository.originalPods.update({ id: row.id }, fields);
      await this.step(sourcing, actorId, `original_pod_${status}`, 'LS_ORIGINAL_POD_RECEIVED', {
        ...input,
        ...(fields.penaltyAmount ? { penalty: fields.penaltyAmount } : {}),
      });
      return (await this.repository.originalPods.findOneBy({ id: row.id }))!;
    } catch (error) {
      rethrow(error, 'Failed to update the original POD');
    }
  }

  async logCall(actorId: string, loadId: string, input: { outcome: string; note?: string }) {
    await this.assertWonLoad(loadId);
    const row = await this.assertTracker(loadId);
    await this.repository.originalPods.update(
      { id: row.id },
      {
        calls: [
          ...row.calls,
          {
            at: this.now().toISOString(),
            by: actorId,
            outcome: input.outcome,
            note: input.note ?? null,
          },
        ],
        updatedBy: actorId,
      },
    );
    return (await this.repository.originalPods.findOneBy({ id: row.id }))!;
  }

  // --- Carrier balance: Payables raises → Super Admin decides → Payables pays -----------------

  /** What the balance would be now, and what still holds it. */
  async balancePreview(loadId: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.workOutBalance(sourcing);
  }

  async raiseBalance(actorId: string, loadId: string): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const existing = await this.repository.findPartnerPayment(sourcing.id, 'balance');
      if (existing && existing.status !== 'rejected') {
        throw new ConflictError(
          `The carrier balance is already ${existing.status.replace('_', ' ')}`,
        );
      }
      const { amounts, holds } = await this.workOutBalance(sourcing);
      if (holds.length) throw new ConflictError(`The balance is on hold: ${holds.join('; ')}`);
      if (amounts.net < 0) {
        throw new ValidationError(
          'Deductions exceed what is owed to the carrier — settle it by hand',
        );
      }
      const data = {
        grossAmount: String(amounts.gross),
        tdsAmount: String(amounts.tds),
        deductionAmount: String(amounts.deductions),
        netAmount: String(amounts.net),
        lines: amounts.lines,
        status: 'raised' as const,
        raisedBy: actorId,
        raisedAt: this.now(),
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
      };
      if (existing) {
        await this.repository.partnerPayments.update({ id: existing.id }, data);
      } else {
        await this.repository.partnerPayments.save(
          this.repository.partnerPayments.create({
            sourcingId: sourcing.id,
            loadId,
            partnerId: sourcing.partnerId!,
            paymentType: 'balance',
            ...data,
          }),
        );
      }
      await this.step(sourcing, actorId, 'partner_balance_raised', 'LS_PARTNER_BALANCE_RAISED', {
        gross: amounts.gross,
        tds: amounts.tds,
        deductions: amounts.deductions,
        net: amounts.net,
      });
      return (await this.repository.findPartnerPayment(sourcing.id, 'balance'))!;
    } catch (error) {
      rethrow(error, 'Failed to raise the carrier balance');
    }
  }

  /** Payables pays the balance Super Admin approved; the load closes once the shipper is
   *  settled too. */
  async payBalance(actorId: string, loadId: string, input: UtrInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const balance = await this.repository.findPartnerPayment(sourcing.id, 'balance');
      if (!balance) throw new ConflictError('The carrier balance has not been raised');
      if (balance.status !== 'approved') {
        throw new ConflictError(
          balance.status === 'paid'
            ? 'The carrier balance is already paid'
            : 'The carrier balance is paid once Super Admin approves it',
        );
      }
      const now = this.now();
      const result = await this.repository.partnerPayments.update(
        { id: balance.id, status: 'approved' },
        { status: 'paid', utrReference: input.utrReference, paidBy: actorId, paidAt: now },
      );
      if (!result.affected) throw new ConflictError('The payment changed — reload it');
      const updated = await this.loadRepository.update(sourcing.tenantId, loadId, {
        partnerBalancePaidAt: now,
        updatedBy: actorId,
      });
      await this.step(sourcing, actorId, 'partner_balance_paid', 'LS_PARTNER_PAID', {
        net: Number(balance.netAmount),
        utrReference: input.utrReference,
      });
      if (updated) await this.stageService.closeIfReady(sourcing.tenantId, actorId, updated);
      return (await this.repository.findPartnerPayment(sourcing.id, 'balance'))!;
    } catch (error) {
      rethrow(error, 'Failed to pay the carrier balance');
    }
  }

  private async workOutBalance(sourcing: LsSourcingEntity) {
    const load = sourcing.load;
    const holds: string[] = [];
    const tracker = await this.repository.originalPods.findOneBy({ loadId: load.id });
    if (!tracker || tracker.status !== 'received_filed') {
      holds.push('the original POD is not received and filed');
    }
    const advance = await this.repository.findPartnerPayment(sourcing.id, 'advance');
    if (advance && advance.status !== 'paid' && advance.status !== 'rejected') {
      holds.push('the carrier advance is not paid yet');
    }
    const claim = await this.repository.findClaim(load.id);
    if (claim && claim.status !== 'settled') holds.push('the claim is still open');
    if (claim) {
      // "With damage noted, waits for the shipper's payment" — the carrier gets what the
      // shipper paid.
      const invoice = await this.repository.findInvoice(sourcing.tenantId, load.id);
      if (!invoice || !INVOICE_SETTLED_STATUSES.includes(invoice.status)) {
        holds.push("the shipper hasn't paid yet (damage was noted)");
      }
    }
    const penalty = tracker
      ? tracker.penaltyAmount !== null
        ? Number(tracker.penaltyAmount)
        : (await this.penaltyFor(tracker, sourcing, istDateOf(this.now()))).penalty
      : 0;
    const amounts = carrierBalance({
      partnerTrip: this.partnerTrip(sourcing, load),
      approvedCharges: await this.repository.approvedChargesTotal(sourcing.tenantId, load.id),
      advanceGross: advance?.status === 'paid' ? Number(advance.grossAmount) : 0,
      lateOriginalPodPenalty: penalty,
      claimRecovery: Number(claim?.partnerRecovery ?? 0),
      tdsPercent: Number(sourcing.partner?.tdsPercent ?? DEFAULT_TDS_PERCENT),
    });
    return { amounts, holds };
  }

  private async penaltyFor(row: LsOriginalPodEntity, sourcing: LsSourcingEntity, today: string) {
    const { values } = await this.settings.forLoad(sourcing.load);
    return originalPodPenalty(
      row.deliveredOn,
      row.receivedAt ? istDateOf(row.receivedAt) : today,
      values.originalPodDueDays,
      values.originalPodPenaltyPerDay,
    );
  }

  private async trackerView(row: LsOriginalPodEntity, sourcing: LsSourcingEntity, today: string) {
    const terms = await this.repository.terms.findOneBy({ tenantId: sourcing.tenantId });
    const { daysLate, penalty } =
      row.penaltyAmount !== null
        ? { daysLate: 0, penalty: Number(row.penaltyAmount) }
        : await this.penaltyFor(row, sourcing, today);
    const load = sourcing.load;
    return {
      tracker: row,
      load: {
        id: load.id,
        code: load.code,
        tenantId: load.tenantId,
        vehicleNumber: load.vehicleNumber,
        status: load.status,
      },
      partner: sourcing.partner
        ? { id: sourcing.partner.id, name: sourcing.partner.name, phone: sourcing.partner.phone }
        : null,
      days: daysBetween(row.deliveredOn, today),
      daysLate,
      penalty,
      lastCall: row.calls.at(-1) ?? null,
      shipperNeedsOriginal: terms?.podType === 'original',
    };
  }

  private async assertTracker(loadId: string): Promise<LsOriginalPodEntity> {
    const row = await this.repository.originalPods.findOneBy({ loadId });
    if (!row) throw new NotFoundError('This load is not on the original POD tracker');
    return row;
  }
}
