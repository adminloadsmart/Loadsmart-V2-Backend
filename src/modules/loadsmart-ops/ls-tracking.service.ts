import { In } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { ElrService } from '../loads/elr/elr.service';
import { LoadChargeEntity } from '../loads/money/load-charge.entity';
import { CHARGE_STAGES } from '../loads/money/money-rules';
import { TransporterChargeHead } from '../loads/money/charge.types';
import { ElrEditInput, ElrInput } from '../loads/utils/elr.interface';
import { LoadStatus } from '../loads/utils/loads.types';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { PreapprovedCharge } from './entities/ls-commercial-terms.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { DEFAULT_TDS_PERCENT, LOADING_SIDE_HEADS, PartnerPaymentStatus } from './loadsmart.types';
import { partnerAdvanceWithCharges } from './loadsmart-rules';
import { LsServiceBase } from './ls-base';
import { LoadsmartActor, UtrInput } from './loadsmart.interface';

/** Tracking raises a charge on a Loadsmart load (with its proof). */
export interface RaiseChargeInput {
  head: TransporterChargeHead;
  amount: number;
  /** Required with the `other` head. */
  remark?: string;
  /** Uploaded by the Tracking member for purpose loads/charge-proof. */
  proofFileKey: string;
}

/** Super Admin's decision on money going out to a carrier. */
export interface PartnerPaymentDecisionInput {
  decision: 'approved' | 'on_hold' | 'rejected';
  /** Required to hold or reject. */
  reason?: string;
}

/** Loading-side charges can be raised at the loading point; every charge until the invoice. */
const RAISE_STAGES: readonly LoadStatus[] = ['reached_loading', ...CHARGE_STAGES];

/** Does the shipper's pre-approval cover this charge? */
export function isPreapproved(
  preapproved: readonly PreapprovedCharge[],
  head: string,
  amount: number,
): boolean {
  return preapproved.some(
    (rule) => rule.head === head && (rule.maxAmount === null || amount <= rule.maxAmount),
  );
}

/**
 * Loadsmart's Tracking team on a load it won:
 * - charges with proof — approved as raised when the shipper pre-approved the head, otherwise
 *   the shipper approves, rejects or queries; Tracking answers a query;
 * - the e-LR (one series across Loadsmart): issue, edit with a reason, cancel, history;
 * - the carrier advance: Tracking raises it (advance % of the carrier's trip plus approved
 *   loading-side charges, less TDS), Super Admin approves, holds or rejects it, Payables pays it
 *   with the UTR. No email or WhatsApp goes out at any step.
 */
export class LsTrackingService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
    private readonly elrService: ElrService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  // --- Charges ------------------------------------------------------------------------------

  async raiseCharge(
    actor: LoadsmartActor,
    loadId: string,
    input: RaiseChargeInput,
  ): Promise<LoadChargeEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (!RAISE_STAGES.includes(load.status)) {
        throw new ConflictError('Charges are raised from the loading point until the invoice');
      }
      const remark = input.remark?.trim() || null;
      if (input.head === 'other' && !remark) {
        throw new ValidationError('Add a remark for a charge under "other"');
      }
      await this.storageService.attachStaffUpload(
        actor.id,
        input.proofFileKey,
        'loads/charge-proof',
        sourcing.tenantId,
      );
      const terms = await this.repository.terms.findOneBy({ tenantId: sourcing.tenantId });
      const preapproved = isPreapproved(terms?.preapprovedCharges ?? [], input.head, input.amount);
      const now = this.now();
      const charge = await this.repository.charges.save(
        this.repository.charges.create({
          tenantId: sourcing.tenantId,
          loadId,
          chargeType: input.head,
          amount: String(input.amount),
          note: remark,
          proofFileKey: input.proofFileKey,
          status: preapproved ? 'approved' : 'raised',
          preapproved,
          raisedByParty: 'loadsmart',
          raisedBy: actor.id,
          ...(preapproved ? { decidedBy: actor.id, decidedAt: now } : {}),
        }),
      );
      await this.documents.save(
        sourcing.tenantId,
        load,
        { updatedBy: actor.id },
        { userId: actor.id, source: 'console' },
        [{ docType: 'charge_proof', fileKey: input.proofFileKey }],
      );
      await this.step(sourcing, actor.id, `${input.head}_charge_raised`, 'LS_CHARGE_RAISED', {
        chargeId: charge.id,
        amount: charge.amount,
        preapproved,
      });
      return charge;
    } catch (error) {
      rethrow(error, 'Failed to raise the charge');
    }
  }

  /** Tracking answers the shipper's query — the charge goes back to the shipper to decide. */
  async replyToChargeQuery(
    actorId: string,
    loadId: string,
    chargeId: string,
    reply: string,
  ): Promise<LoadChargeEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const charge = await this.repository.charges.findOneBy({
        id: chargeId,
        tenantId: sourcing.tenantId,
        loadId,
      });
      if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
      if (charge.status !== 'queried')
        throw new ConflictError('The shipper has not queried this charge');
      const result = await this.repository.charges.update(
        { id: chargeId, status: 'queried' },
        { status: 'raised', queryReply: reply, repliedAt: this.now() },
      );
      if (!result.affected) throw new ConflictError('The charge changed — reload it');
      await this.step(
        sourcing,
        actorId,
        `${charge.chargeType}_charge_query_answered`,
        'LS_CHARGE_RAISED',
        {
          chargeId,
          reply,
        },
      );
      return (await this.repository.charges.findOneBy({ id: chargeId }))!;
    } catch (error) {
      rethrow(error, 'Failed to answer the query');
    }
  }

  // --- e-LR ---------------------------------------------------------------------------------

  async issueElr(actor: LoadsmartActor, loadId: string, input: ElrInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.elrService.issue(sourcing.tenantId, actor.id, actor.role, loadId, input);
  }

  async editElr(actor: LoadsmartActor, loadId: string, input: ElrEditInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.elrService.edit(sourcing.tenantId, actor.id, actor.role, loadId, input);
  }

  async cancelElr(actorId: string, loadId: string, note: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.elrService.cancel(sourcing.tenantId, actorId, loadId, note);
  }

  async elrRevisions(loadId: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.elrService.listRevisions(sourcing.tenantId, loadId);
  }

  // --- Carrier advance: Tracking raises → Super Admin decides → Payables pays ----------------

  /** Tracking raises the carrier's advance once Loaded. A rejected advance can be raised again. */
  async raisePartnerAdvance(actorId: string, loadId: string): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('The carrier advance is raised once Loaded');
      }
      const existing = await this.repository.findPartnerPayment(sourcing.id, 'advance');
      if (existing && existing.status !== 'rejected') {
        throw new ConflictError(
          `The carrier advance is already ${existing.status.replace('_', ' ')}`,
        );
      }
      const charges = await this.repository.charges.findBy({
        tenantId: sourcing.tenantId,
        loadId,
        status: 'approved',
        chargeType: In([...LOADING_SIDE_HEADS]),
      });
      const advancePercent = Number(
        sourcing.partner?.advancePercent ?? sourcing.truckerAdvancePercent,
      );
      const amounts = partnerAdvanceWithCharges(
        this.partnerTrip(sourcing, load),
        advancePercent,
        charges.map((charge) => ({ head: charge.chargeType, amount: Number(charge.amount) })),
        Number(sourcing.partner?.tdsPercent ?? DEFAULT_TDS_PERCENT),
      );
      const data = {
        grossAmount: String(amounts.gross),
        tdsAmount: String(amounts.tds),
        deductionAmount: '0',
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
            paymentType: 'advance',
            ...data,
          }),
        );
      }
      await this.step(sourcing, actorId, 'partner_advance_raised', 'LS_PARTNER_ADVANCE_RAISED', {
        advancePercent,
        gross: amounts.gross,
        tds: amounts.tds,
        net: amounts.net,
      });
      return (await this.repository.findPartnerPayment(sourcing.id, 'advance'))!;
    } catch (error) {
      rethrow(error, 'Failed to raise the carrier advance');
    }
  }

  /** Super Admin's queue (raised, on hold) and Payables' (approved). */
  listPartnerPayments(statuses: PartnerPaymentStatus[]): Promise<LsPartnerPaymentEntity[]> {
    return this.repository.partnerPayments.find({
      where: { status: In(statuses) },
      order: { raisedAt: 'ASC' },
    });
  }

  /** Super Admin approves, holds or rejects the advance — with a reason to hold or reject. */
  async decidePartnerPayment(
    actorId: string,
    paymentId: string,
    input: PartnerPaymentDecisionInput,
  ): Promise<LsPartnerPaymentEntity> {
    try {
      const payment = await this.repository.partnerPayments.findOneBy({ id: paymentId });
      if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
      if (payment.status !== 'raised' && payment.status !== 'on_hold') {
        throw new ConflictError(`This payment is already ${payment.status.replace('_', ' ')}`);
      }
      const reason = input.reason?.trim() || null;
      if (input.decision !== 'approved' && !reason) {
        throw new ValidationError('Give a reason to hold or reject the payment');
      }
      const result = await this.repository.partnerPayments.update(
        { id: paymentId, status: payment.status },
        {
          status: input.decision,
          decidedBy: actorId,
          decidedAt: this.now(),
          decisionReason: reason,
        },
      );
      if (!result.affected) throw new ConflictError('The payment changed — reload it');
      const sourcing = await this.assertSourcing(payment.sourcingId);
      await this.step(
        sourcing,
        actorId,
        `partner_${payment.paymentType}_${input.decision}`,
        'LS_PARTNER_PAYMENT_DECIDED',
        { paymentId, decision: input.decision, reason },
      );
      return (await this.repository.partnerPayments.findOneBy({ id: paymentId }))!;
    } catch (error) {
      rethrow(error, 'Failed to decide the payment');
    }
  }

  /** Payables pays the approved advance and records the UTR. */
  async payPartnerAdvance(
    actorId: string,
    loadId: string,
    input: UtrInput,
  ): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const advance = await this.repository.findPartnerPayment(sourcing.id, 'advance');
      if (!advance) throw new ConflictError('Tracking has not raised the carrier advance');
      if (advance.status !== 'approved') {
        throw new ConflictError(
          advance.status === 'paid'
            ? 'The carrier advance is already paid'
            : 'The carrier advance is paid once Super Admin approves it',
        );
      }
      const result = await this.repository.partnerPayments.update(
        { id: advance.id, status: 'approved' },
        { status: 'paid', utrReference: input.utrReference, paidBy: actorId, paidAt: this.now() },
      );
      if (!result.affected) throw new ConflictError('The payment changed — reload it');
      await this.step(sourcing, actorId, 'partner_advance_paid', 'LS_PARTNER_PAID', {
        gross: Number(advance.grossAmount),
        tds: Number(advance.tdsAmount),
        net: Number(advance.netAmount),
        utrReference: input.utrReference,
      });
      return (await this.repository.findPartnerPayment(sourcing.id, 'advance'))!;
    } catch (error) {
      rethrow(error, 'Failed to pay the carrier advance');
    }
  }
}
