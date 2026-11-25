import { In, IsNull } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { LoadPostingService } from '../loads/load-posting/load-posting.service';
import { EditPostingDetailsInput } from '../loads/load-posting/utils/load-posting.interface';
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
import { LsStaffNotifier } from './ls-staff-notifier';
import { LS_MONEY_APPROVE, LS_PAYABLES, LS_TRACKING } from '../../shared/constants/permissions';
import { ChargeQueryReplyInput, LoadsmartActor, PartnerPayInput } from './loadsmart.interface';
import type { NotificationTriggers } from '../notifications/notifications.interface';
import { attachPaymentProof } from './ls-payment-proof';

/** Tracking raises a charge on a Loadsmart load (with its proof). */
export interface RaiseChargeInput {
  head: TransporterChargeHead;
  amount: number;
  /** Required with the `other` head. */
  remark?: string;
  /** Optional. Uploaded by the Tracking member for purpose loads/charge-proof. */
  proofFileKey?: string;
}

/** Super Admin's decision on a charge the shipper has approved. */
export interface ChargeAdminDecisionInput {
  decision: 'approved' | 'rejected';
  /** Required to reject. */
  reason?: string;
}

/** Which approved loading-side charges go with the advance (default: all that are not yet sent). */
export interface RaiseAdvanceInput {
  chargeIds?: string[];
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

/** The notice Super Admin gets when a charge has cleared the shipper and waits for them. */
/** "unloading_detention" → "Unloading detention". */
export const chargeHeadLabel = (head: string) =>
  head.charAt(0).toUpperCase() + head.slice(1).replace(/_/g, ' ');

export function chargeNeedsAdmin(loadCode: string, charge: LoadChargeEntity, head: string) {
  return {
    type: 'charge.pending_admin',
    title: `Charge waiting for approval — ${loadCode}`,
    body: `The ${head.replace(/_/g, ' ')} charge of ₹${charge.amount} on ${loadCode} cleared the shipper and needs Super Admin.`,
    loadId: charge.loadId,
    metadata: { chargeId: charge.id, amount: charge.amount },
  };
}

/**
 * Loadsmart's Tracking team on a load it won:
 * - charges (proof optional) — the shipper approves, rejects or queries (a pre-approved head skips
 *   that step), then Super Admin approves or rejects; Tracking answers a query;
 * - the e-LR (one series across Loadsmart): issue, edit with a reason, cancel, history;
 * - the carrier advance: Tracking raises it (advance % of the carrier's trip plus approved
 *   loading-side charges, less TDS), Super Admin approves, holds or rejects it, Payables pays it
 *   with the UTR. Each step drops an in-app notice in the ops inbox (LsStaffNotifier): raised → Payables
 *   and Super Admin; decided → the member who raised it (and Payables once approved); paid → the member
 *   who raised it. No email or WhatsApp goes out.
 */
export class LsTrackingService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
    private readonly elrService: ElrService,
    private readonly notifier: LsStaffNotifier,
    private readonly postingService: LoadPostingService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  /** Notifications to shipper users — optional so tests and callers without a queue still work. */
  private notificationTriggers?: NotificationTriggers;
  setNotificationTriggers(triggers: NotificationTriggers | undefined): void {
    this.notificationTriggers = triggers;
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
      if (input.proofFileKey) {
        await this.storageService.attachStaffUpload(
          actor.id,
          input.proofFileKey,
          'loads/charge-proof',
          sourcing.tenantId,
        );
      }
      const terms = await this.repository.terms.findOneBy({ tenantId: sourcing.tenantId });
      const preapproved = isPreapproved(terms?.preapprovedCharges ?? [], input.head, input.amount);
      const now = this.now();
      // The shipper's pre-approval covers the shipper's step only; Super Admin still decides.
      const charge = await this.repository.charges.save(
        this.repository.charges.create({
          tenantId: sourcing.tenantId,
          loadId,
          chargeType: input.head,
          amount: String(input.amount),
          note: remark,
          proofFileKey: input.proofFileKey ?? null,
          status: preapproved ? 'pending_admin' : 'raised',
          preapproved,
          raisedByParty: 'loadsmart',
          raisedBy: actor.id,
          ...(preapproved ? { decidedAt: now } : {}),
        }),
      );
      if (input.proofFileKey) {
        await this.documents.save(
          sourcing.tenantId,
          load,
          { updatedBy: actor.id },
          { userId: actor.id, source: 'console' },
          [{ docType: 'charge_proof', fileKey: input.proofFileKey }],
        );
      }
      await this.step(sourcing, actor.id, `${input.head}_charge_raised`, 'LS_CHARGE_RAISED', {
        chargeId: charge.id,
        amount: charge.amount,
        preapproved,
      });
      if (preapproved) {
        await this.notifier.notifyPermission(
          [LS_MONEY_APPROVE],
          chargeNeedsAdmin(load.code, charge, input.head),
          actor.id,
        );
      }
      return charge;
    } catch (error) {
      rethrow(error, 'Failed to raise the charge');
    }
  }

  /** Tracking answers the shipper's query — the charge goes back to the shipper to decide, and
   *  the shipper user who asked is told (in-app + push). */
  async replyToChargeQuery(
    actorId: string,
    loadId: string,
    chargeId: string,
    input: ChargeQueryReplyInput,
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
      if (input.attachmentFileKey) {
        await this.storageService.attachStaffUpload(
          actorId,
          input.attachmentFileKey,
          'loads/charge-proof',
          sourcing.tenantId,
        );
      }
      const result = await this.repository.charges.update(
        { id: chargeId, status: 'queried' },
        {
          status: 'raised',
          queryReply: input.reply,
          repliedAt: this.now(),
          repliedBy: actorId,
          replyTag: input.tag ?? null,
          replyFileKey: input.attachmentFileKey ?? null,
        },
      );
      if (!result.affected) throw new ConflictError('The charge changed — reload it');
      await this.step(
        sourcing,
        actorId,
        `${charge.chargeType}_charge_query_answered`,
        'LS_CHARGE_RAISED',
        {
          chargeId,
          reply: input.reply,
          tag: input.tag ?? null,
        },
      );
      if (charge.queriedBy && this.notificationTriggers) {
        // Best-effort: a notification that fails must not undo the answer.
        await this.notificationTriggers
          .enqueue('load.charge_query_answered', sourcing.tenantId, {
            loadId,
            loadCode: sourcing.load?.code,
            chargeId,
            queriedBy: charge.queriedBy,
            chargeLabel: chargeHeadLabel(charge.chargeType),
            amount: `₹${Number(charge.amount).toLocaleString('en-IN')}`,
            reply: input.reply,
          })
          .catch((error) => console.warn('Charge query answer notification failed', error));
      }
      return (await this.repository.charges.findOneBy({ id: chargeId }))!;
    } catch (error) {
      rethrow(error, 'Failed to answer the query');
    }
  }

  /** Super Admin's decision on a charge the shipper has approved — the second approval. Only an
   *  approved charge reaches the shipper's invoice and the carrier's pay. */
  async decideChargeAsAdmin(
    actorId: string,
    loadId: string,
    chargeId: string,
    input: ChargeAdminDecisionInput,
  ): Promise<LoadChargeEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const charge = await this.repository.charges.findOneBy({
        id: chargeId,
        tenantId: sourcing.tenantId,
        loadId,
      });
      if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
      if (charge.status !== 'pending_admin') {
        throw new ConflictError(
          charge.status === 'approved' || charge.status === 'rejected'
            ? `This charge is already ${charge.status}`
            : 'The shipper has not approved this charge yet',
        );
      }
      const reason = input.reason?.trim() || null;
      if (input.decision === 'rejected' && !reason) {
        throw new ValidationError('Give a reason to reject the charge');
      }
      const result = await this.repository.charges.update(
        { id: chargeId, status: 'pending_admin' },
        {
          status: input.decision,
          adminDecidedBy: actorId,
          adminDecidedAt: this.now(),
          rejectionReason: input.decision === 'rejected' ? reason : charge.rejectionReason,
        },
      );
      if (!result.affected) throw new ConflictError('The charge changed — reload it');
      await this.step(
        sourcing,
        actorId,
        `${charge.chargeType}_charge_admin_${input.decision}`,
        'LS_CHARGE_DECIDED',
        { chargeId, amount: charge.amount, decision: input.decision, reason },
      );
      await this.notifier.notifyUsers([charge.raisedBy], {
        type: `charge.${input.decision}`,
        title: `Charge ${input.decision} — ${sourcing.load.code}`,
        body: `Super Admin ${input.decision} the ${charge.chargeType.replace(/_/g, ' ')} charge of ₹${charge.amount} on ${sourcing.load.code}${reason ? `: ${reason}` : ''}.`,
        loadId,
        metadata: { chargeId, decision: input.decision, reason },
      });
      return (await this.repository.charges.findOneBy({ id: chargeId }))!;
    } catch (error) {
      rethrow(error, 'Failed to decide the charge');
    }
  }

  // --- Ownership -----------------------------------------------------------------------------

  /** "Claim this load as mine": a Tracking member takes a load nobody runs yet. */
  async claimLoad(actorId: string, loadId: string) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const result = await this.repository.sourcings.update(
        { id: sourcing.id, trackingOwnerId: IsNull() },
        { trackingOwnerId: actorId, trackingClaimedAt: this.now() },
      );
      if (!result.affected) {
        throw new ConflictError(
          sourcing.trackingOwnerId === actorId
            ? 'This load is already yours'
            : 'Another Tracking member already runs this load',
        );
      }
      await this.step(sourcing, actorId, 'tracking_owner_claimed', 'LS_TRACKING_ASSIGNED', {
        from: null,
        to: actorId,
        by: 'self_claim',
      });
      return this.repository.findSourcingByLoad(loadId);
    } catch (error) {
      rethrow(error, 'Failed to claim the load');
    }
  }

  /** Super Admin moves a load to another Tracking member by hand. */
  async moveTrackingOwner(actorId: string, sourcingId: string, ownerId: string) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const holders = await this.repository.listStaffWithPermission([LS_TRACKING]);
      if (!holders.some((user) => user.id === ownerId)) {
        throw new ValidationError(`Not on the Tracking team: ${ownerId}`);
      }
      const updated = await this.repository.updateSourcing(sourcing.id, {
        trackingOwnerId: ownerId,
        trackingClaimedAt: this.now(),
      });
      await this.step(sourcing, actorId, 'tracking_owner_moved', 'LS_TRACKING_ASSIGNED', {
        from: sourcing.trackingOwnerId,
        to: ownerId,
        by: 'super_admin',
      });
      await this.notifier.notifyUsers([ownerId], {
        type: 'tracking.assigned',
        title: `A load was assigned to you — ${sourcing.load.code}`,
        body: `Super Admin moved ${sourcing.load.code} to you.`,
        loadId: sourcing.loadId,
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to move the load');
    }
  }

  // --- e-LR ---------------------------------------------------------------------------------

  /** Edit a load on Tracking's desk: the reporting time and the pickup / drop area. The same rules
   *  as the shipper's edit once a truck is awarded (a time can change until the truck reaches the
   *  loading point, the pickup area until Loaded, the drop area until delivered). The shipper's
   *  other fields (truck, cargo, price) are not Tracking's to change. */
  async editLoadDetails(actorId: string, loadId: string, input: EditPostingDetailsInput) {
    const sourcing = await this.assertWonLoad(loadId);
    const postingId = sourcing.load.postingId;
    if (!postingId) throw new ConflictError('This load has no posting to edit');
    return this.postingService.editDetails(sourcing.tenantId, actorId, postingId, input);
  }

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

  /** Tracking raises the carrier's advance once Loaded. A rejected advance can be raised again, and
   *  one still waiting (raised or on hold) can be raised again with a different set of charges —
   *  it goes back to Super Admin with the new amounts. Loading-side charges not sent with the
   *  advance are paid with the balance. */
  async raisePartnerAdvance(
    actorId: string,
    loadId: string,
    input: RaiseAdvanceInput = {},
  ): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('The carrier advance is raised once Loaded');
      }
      const existing = await this.repository.findPartnerPayment(sourcing.id, 'advance');
      const waiting = existing?.status === 'raised' || existing?.status === 'on_hold';
      if (existing && existing.status !== 'rejected' && !(waiting && input.chargeIds?.length)) {
        throw new ConflictError(
          `The carrier advance is already ${existing.status.replace('_', ' ')}`,
        );
      }
      // Approved loading-side charges not yet sent with an advance (or sent with this one).
      const candidates = await this.repository.charges.find({
        where: [
          {
            tenantId: sourcing.tenantId,
            loadId,
            status: 'approved',
            chargeType: In([...LOADING_SIDE_HEADS]),
            partnerPaymentId: IsNull(),
          },
          ...(existing
            ? [
                {
                  tenantId: sourcing.tenantId,
                  loadId,
                  status: 'approved' as const,
                  chargeType: In([...LOADING_SIDE_HEADS]),
                  partnerPaymentId: existing.id,
                },
              ]
            : []),
        ],
      });
      const wanted = input.chargeIds ? new Set(input.chargeIds) : null;
      const charges = wanted ? candidates.filter((charge) => wanted.has(charge.id)) : candidates;
      if (wanted && charges.length !== wanted.size) {
        throw new ValidationError(
          'Only approved loading-side charges that are not already paid can go with the advance',
        );
      }
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
      const raised = (await this.repository.findPartnerPayment(sourcing.id, 'advance'))!;
      // Remember which charges travel with this advance; the rest go with the balance.
      await this.repository.charges.update(
        { loadId, partnerPaymentId: raised.id },
        { partnerPaymentId: null },
      );
      if (charges.length) {
        await this.repository.charges.update(
          { id: In(charges.map((charge) => charge.id)) },
          { partnerPaymentId: raised.id },
        );
      }
      // Accounts Payable (and Super Admin, who decides) hear about it the moment it is raised.
      await this.notifier.notifyPermission(
        [LS_PAYABLES, LS_MONEY_APPROVE],
        {
          type: 'partner_advance.raised',
          title: `Carrier advance raised — ${load.code}`,
          body: `Tracking raised a carrier advance of ₹${amounts.net} (net of TDS) for ${load.code}. Super Admin decides, then Payables pays.`,
          loadId,
          metadata: { paymentId: raised.id, gross: amounts.gross, net: amounts.net },
        },
        actorId,
      );
      return raised;
    } catch (error) {
      rethrow(error, 'Failed to raise the carrier advance');
    }
  }

  /** A load's carrier payments with the UTR and a download link for the payment advice — what
   *  Tracking passes to the broker once Payables has paid. */
  async partnerPaymentsOf(actor: LoadsmartActor, loadId: string) {
    const sourcing = await this.assertWonLoad(loadId);
    const payments = await this.repository.partnerPayments.find({
      where: { sourcingId: sourcing.id },
      order: { paymentType: 'ASC' },
    });
    return Promise.all(
      payments.map(async (payment) => ({
        ...payment,
        proofUrl: payment.proofFileKey
          ? (
              await this.storageService.getByKey(
                { tenantId: sourcing.tenantId, role: actor.role },
                payment.proofFileKey,
              )
            ).downloadUrl
          : null,
      })),
    );
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
      const code = sourcing.load?.code ?? payment.loadId;
      const verb = input.decision.replace('_', ' ');
      const notice = {
        type: `partner_${payment.paymentType}.${input.decision}`,
        title: `Carrier ${payment.paymentType} ${verb} — ${code}`,
        body: `Super Admin ${verb === 'approved' ? 'approved' : `put the ${payment.paymentType} ${verb}`} for ${code}${reason ? `: ${reason}` : ''}.`,
        loadId: payment.loadId,
        metadata: { paymentId, decision: input.decision, reason },
      };
      await this.notifier.notifyUsers([payment.raisedBy], notice);
      if (input.decision === 'approved') {
        await this.notifier.notifyPermission(
          [LS_PAYABLES],
          { ...notice, title: `Ready to pay: carrier ${payment.paymentType} — ${code}` },
          actorId,
        );
      }
      return (await this.repository.partnerPayments.findOneBy({ id: paymentId }))!;
    } catch (error) {
      rethrow(error, 'Failed to decide the payment');
    }
  }

  /** Payables pays the approved advance and records the UTR. */
  async payPartnerAdvance(
    actorId: string,
    loadId: string,
    input: PartnerPayInput,
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
      if (input.proofFileKey) {
        await attachPaymentProof(
          this.storageService,
          this.documents,
          actorId,
          sourcing.tenantId,
          sourcing.load,
          input.proofFileKey,
        );
      }
      const result = await this.repository.partnerPayments.update(
        { id: advance.id, status: 'approved' },
        {
          status: 'paid',
          utrReference: input.utrReference ?? null,
          proofFileKey: input.proofFileKey ?? null,
          paidBy: actorId,
          paidAt: this.now(),
        },
      );
      if (!result.affected) throw new ConflictError('The payment changed — reload it');
      await this.step(sourcing, actorId, 'partner_advance_paid', 'LS_PARTNER_PAID', {
        gross: Number(advance.grossAmount),
        tds: Number(advance.tdsAmount),
        net: Number(advance.netAmount),
        utrReference: input.utrReference ?? null,
        proofFileKey: input.proofFileKey ?? null,
      });
      await this.notifyParties?.({
        kind: 'partner_paid',
        tenantId: sourcing.tenantId,
        loadId,
        partnerPaymentId: advance.id,
      });
      await this.notifier.notifyUsers([advance.raisedBy], {
        type: 'partner_advance.paid',
        title: `Carrier advance paid — ${sourcing.load.code}`,
        body: `Payables paid the carrier advance for ${sourcing.load.code} ${input.utrReference ? `(UTR ${input.utrReference})` : '(payment advice attached)'}. You can pass the proof to the broker.`,
        loadId,
        metadata: { paymentId: advance.id, utrReference: input.utrReference ?? null },
      });
      return (await this.repository.findPartnerPayment(sourcing.id, 'advance'))!;
    } catch (error) {
      rethrow(error, 'Failed to pay the carrier advance');
    }
  }
}
