import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { CodeSequenceRepository } from '../loads/code-sequence.repository';
import { LoadActivityService } from '../loads/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentRepository } from '../loads/load-payment.repository';
import { LoadPaymentService } from '../loads/load-payment.service';
import { LoadRepository } from '../loads/load.repository';
import { LoadService } from '../loads/load.service';
import { LoadStageService } from '../loads/load-stage.service';
import { renderElrPdf } from '../loads/elr/elr-pdf';
import { LoadStatus, PodReviewDecision } from '../loads/utils/loads.types';
import { istDateOf } from '../loads/verification/verification-rules';
import { NotificationTriggers } from '../notifications/notification-triggers';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import {
  DEFAULT_GST_PERCENT,
  DEFAULT_INVOICE_DUE_DAYS,
  DEFAULT_TDS_PERCENT,
} from './loadsmart.types';
import { invoiceAmounts, partnerBalance, tripAmount } from './loadsmart-rules';
import { LsServiceBase } from './ls-base';

/** Loadsmart-wide invoice numbering — one sequence across every shipper. */
const LOADSMART_INVOICE_SCOPE = '00000000-0000-0000-0000-000000000000';
const INVOICE_NUMBER_OFFSET = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The shipper's finance team is reminded this long before the invoice falls due. */
const INVOICE_REMINDER_LEAD_MS = 2 * DAY_MS;

const rupees = (value: string | number) => `₹${Number(value).toFixed(2)}`;

/**
 * Loadsmart load, part 2 — drop to payment, run by the ops console:
 * - the Tracking team approves the POD; an issue noted on it opens a CS ticket, the shipper adds
 *   the claim value and the CS team settles it with the partner (money waits until then);
 * - the POD team rates shipper and partner and marks the signed original POD received (stage 11);
 * - Receivables raises the invoice (stage 12) — freight at Loadsmart's price plus approved
 *   charges, less the settled claim, plus GST, less the advance received;
 * - the shipper pays it with a UTR (stage 13) and Receivables verifies it;
 * - Payables pays the partner's balance, less advance, claim recovery and TDS;
 * - with both sides paid the load closes.
 */
export class LsSettlementService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly loadService: LoadService,
    private readonly stageService: LoadStageService,
    private readonly loadPaymentService: LoadPaymentService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly storageService: StorageService,
    private readonly triggers: NotificationTriggers,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  /** Stage hook: a Loadsmart load delivered with issues opens its CS ticket. */
  onStageEntered = async (load: LoadEntity, to: LoadStatus): Promise<void> => {
    if (load.sourceType !== 'loadsmart' || to !== 'delivered_with_issues') return;
    const existing = await this.repository.findClaim(load.id);
    if (existing) {
      await this.repository.claims.update(
        { id: existing.id },
        { status: 'open', issue: load.shortageOrDamage },
      );
      return;
    }
    await this.repository.claims.save(
      this.repository.claims.create({
        tenantId: load.tenantId,
        loadId: load.id,
        status: 'open',
        issue: load.shortageOrDamage,
      }),
    );
  };

  // --- 29–31 · POD and CS -----------------------------------------------------------------

  /** "Tracking team approves the POD." */
  async reviewPod(actorId: string, loadId: string, decision: PodReviewDecision, reason?: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.loadService.reviewPod(sourcing.tenantId, actorId, loadId, decision, reason, true);
  }

  async csQueue(): Promise<{ load: LoadEntity; claim: LoadClaimEntity | null }[]> {
    const sourcings = await this.repository.listLoadsAt(['delivered_with_issues']);
    return Promise.all(
      sourcings.map(async (s) => ({
        load: s.load,
        claim: await this.repository.findClaim(s.loadId),
      })),
    );
  }

  /** "The team settles it with the partner": once the shipper has added the claim value, CS
   *  records what is recovered from the partner, and the load is Delivered without issues. */
  async settleClaim(
    actorId: string,
    loadId: string,
    input: { partnerRecovery: number; note: string },
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const claim = await this.repository.findClaim(loadId);
      if (!claim || claim.status !== 'open') throw new ConflictError('This load has no open claim');
      if (claim.claimValue === null) {
        throw new ConflictError('The shipper has to add the claim value first');
      }
      await this.repository.claims.update(
        { id: claim.id },
        {
          status: 'settled',
          partnerRecovery: String(input.partnerRecovery),
          resolutionNote: input.note,
          settledBy: actorId,
          settledAt: this.now(),
        },
      );
      const load = await this.loadService.settleDeliveryIssue(
        sourcing.tenantId,
        actorId,
        loadId,
        input.note,
        true,
      );
      await this.step(sourcing, actorId, 'claim_settled', 'LS_CLAIM_UPDATED', {
        claimValue: claim.claimValue,
        partnerRecovery: input.partnerRecovery,
      });
      return load;
    } catch (error) {
      rethrow(error, 'Failed to settle the claim');
    }
  }

  // --- 32–33 · POD team -------------------------------------------------------------------

  async podQueue() {
    const sourcings = await this.repository.listLoadsAt(['delivered_ok']);
    return sourcings.filter((s) => s.load.podStatus === 'accepted');
  }

  /** "Rates the shipper and the partner." */
  async rate(
    actorId: string,
    loadId: string,
    input: { shipperScore: number; partnerScore: number; note?: string },
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      for (const [subject, score] of [
        ['shipper', input.shipperScore],
        ['partner', input.partnerScore],
      ] as const) {
        await this.repository.ratings.upsert(
          {
            tenantId: sourcing.tenantId,
            loadId,
            subject,
            partnerId: subject === 'partner' ? sourcing.partnerId : null,
            score,
            note: input.note ?? null,
            ratedBy: actorId,
          },
          ['loadId', 'subject'],
        );
      }
      await this.step(sourcing, actorId, 'rated', 'LS_LOAD_RATED', {
        shipperScore: input.shipperScore,
        partnerScore: input.partnerScore,
      });
      return this.repository.ratings.findBy({ loadId });
    } catch (error) {
      rethrow(error, 'Failed to rate the load');
    }
  }

  /** "Sends the original POD" — the POD team marks the signed original received at the office.
   *  "Original POD unlocks money." */
  async markOriginalPodReceived(
    actorId: string,
    loadId: string,
    input: { courierName?: string; trackingNumber?: string },
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      await this.repository.updateSourcing(sourcing.id, {
        originalPodCourier: input.courierName ?? null,
        originalPodTrackingNumber: input.trackingNumber ?? null,
      });
      const load = await this.stageService.transition({
        tenantId: sourcing.tenantId,
        loadId,
        to: 'original_pod_received',
        actorId,
        auditAction: 'LS_ORIGINAL_POD_RECEIVED',
        metadata: { ...input },
      });
      return load;
    } catch (error) {
      rethrow(error, 'Failed to mark the original POD received');
    }
  }

  // --- 34–36 · Receivables and Payables ---------------------------------------------------

  private async claimOf(loadId: string) {
    const claim = await this.repository.findClaim(loadId);
    if (claim && claim.status !== 'settled')
      throw new ConflictError('The claim on this load is still open');
    return claim;
  }

  /** "Receivables raises the shipper's invoice with the POD." */
  async generateInvoice(
    actor: { id: string; role: string },
    loadId: string,
    input: { gstPercent?: number; dueDays?: number },
  ): Promise<{ invoice: LsInvoiceEntity; downloadUrl: string | null }> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (load.status !== 'original_pod_received') {
        throw new ConflictError('The invoice is raised once the original POD is received');
      }
      if (await this.repository.findInvoice(sourcing.tenantId, loadId)) {
        throw new ConflictError('This load is already invoiced');
      }
      const claim = await this.claimOf(loadId);
      const payments = await this.loadPaymentRepository.listByLoad(sourcing.tenantId, loadId);
      const advance = payments.find((p) => p.paymentType === 'advance');
      const amounts = invoiceAmounts({
        freight: tripAmount(
          Number(load.freightValue ?? 0),
          load.freightType,
          Number(load.plannedCapacityTonnes),
        ),
        approvedCharges: await this.repository.approvedChargesTotal(sourcing.tenantId, loadId),
        claimCredit: Number(claim?.claimValue ?? 0),
        gstPercent: input.gstPercent ?? DEFAULT_GST_PERCENT,
        advanceReceived: Number(advance?.amount ?? 0),
      });
      const now = this.now();
      const dueDate = istDateOf(
        new Date(now.getTime() + (input.dueDays ?? DEFAULT_INVOICE_DUE_DAYS) * DAY_MS),
      );
      const sequence = await this.dataSource.transaction((manager) =>
        this.codeSequenceRepository.next('ls_invoice', LOADSMART_INVOICE_SCOPE, manager),
      );
      const invoiceNumber = `LSI-${INVOICE_NUMBER_OFFSET + sequence}`;

      const pdf = await renderElrPdf({
        title: 'Loadsmart · Tax Invoice',
        numberLabel: 'Invoice number',
        elrNumber: invoiceNumber,
        date: istDateOf(now),
        sections: [
          {
            heading: 'Load',
            rows: [
              { label: 'Load', value: load.code },
              { label: 'Vehicle', value: load.vehicleNumber ?? '—' },
              { label: 'E-LR', value: load.elrNumber ?? '—' },
            ],
          },
          {
            heading: 'Amounts',
            rows: [
              { label: 'Freight', value: rupees(amounts.freight) },
              { label: 'Approved charges', value: rupees(amounts.charges) },
              { label: 'Claim credit', value: `− ${rupees(amounts.claimCredit)}` },
              { label: 'Taxable value', value: rupees(amounts.taxable) },
              { label: `GST ${amounts.gstPercent}%`, value: rupees(amounts.gst) },
              { label: 'Invoice total', value: rupees(amounts.total) },
              { label: 'Advance received', value: `− ${rupees(amounts.advanceReceived)}` },
              { label: 'Balance due', value: rupees(amounts.balanceDue) },
              { label: 'Due date', value: dueDate },
            ],
          },
        ],
      });
      const file = await this.storageService.uploadTenantFile(
        sourcing.tenantId,
        actor.id,
        {
          purpose: 'loads/invoice',
          fileName: `${invoiceNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
        },
        pdf,
      );

      const invoice = await this.repository.invoices.save(
        this.repository.invoices.create({
          tenantId: sourcing.tenantId,
          loadId,
          invoiceNumber,
          freightAmount: String(amounts.freight),
          chargesAmount: String(amounts.charges),
          claimCredit: String(amounts.claimCredit),
          taxableAmount: String(amounts.taxable),
          gstPercent: String(amounts.gstPercent),
          gstAmount: String(amounts.gst),
          totalAmount: String(amounts.total),
          advanceReceived: String(amounts.advanceReceived),
          balanceDue: String(amounts.balanceDue),
          dueDate,
          fileKey: file.key,
          issuedBy: actor.id,
        }),
      );
      await this.stageService.transition({
        tenantId: sourcing.tenantId,
        loadId,
        to: 'invoice_generated',
        actorId: actor.id,
        auditAction: 'LS_INVOICE_GENERATED',
        metadata: { invoiceNumber, balanceDue: amounts.balanceDue },
      });

      // "Reminds the shipper before the due date."
      const remindInMs =
        new Date(`${dueDate}T00:00:00+05:30`).getTime() - INVOICE_REMINDER_LEAD_MS - now.getTime();
      if (remindInMs > 0) {
        await this.triggers.enqueue(
          'load.invoice_due_reminder',
          sourcing.tenantId,
          { loadId, invoiceNumber, balanceDue: rupees(amounts.balanceDue), dueDate },
          { delayMs: remindInMs },
        );
      }

      const { downloadUrl } = await this.storageService.getByKey(
        { tenantId: sourcing.tenantId, role: actor.role },
        file.key,
      );
      return { invoice, downloadUrl };
    } catch (error) {
      rethrow(error, 'Failed to generate the invoice');
    }
  }

  /** Everything Loadsmart holds on one load — the console's load page. */
  async loadDetail(loadId: string) {
    const sourcing = await this.repository.findSourcingByLoad(loadId);
    if (!sourcing) throw new NotFoundError(`Loadsmart load ${loadId} not found`);
    const [partnerBids, partnerPayments, charges, claim, invoice, ratings] = await Promise.all([
      this.repository.listPartnerBids(sourcing.id),
      this.repository.partnerPayments.findBy({ sourcingId: sourcing.id }),
      this.repository.listCharges(sourcing.tenantId, sourcing.loadId),
      this.repository.findClaim(sourcing.loadId),
      this.repository.findInvoice(sourcing.tenantId, sourcing.loadId),
      this.repository.ratings.findBy({ loadId: sourcing.loadId }),
    ]);
    return { sourcing, partnerBids, partnerPayments, charges, claim, invoice, ratings };
  }

  /** LoadsmartBilling for LoadPaymentService — the balance the shipper pays. */
  balanceDueOf = async (tenantId: string, loadId: string): Promise<string | null> => {
    return (await this.repository.findInvoice(tenantId, loadId))?.balanceDue ?? null;
  };

  async receivablesQueue() {
    const sourcings = await this.repository.listLoadsAt(['invoice_generated', 'payment']);
    return Promise.all(
      sourcings.map(async (s) => ({
        load: s.load,
        invoice: await this.repository.findInvoice(s.tenantId, s.loadId),
        pendingPayments: (await this.loadPaymentRepository.listByLoad(s.tenantId, s.loadId)).filter(
          (p) => p.verificationStatus === 'pending',
        ),
      })),
    );
  }

  /** "Receivables verifies it — matches the UTR with the bank statement." */
  async decidePayment(
    actorId: string,
    loadId: string,
    paymentId: string,
    decision: 'verified' | 'rejected',
    reason?: string,
  ) {
    const sourcing = await this.assertWonLoad(loadId);
    const payment = await this.loadPaymentService.decideLoadsmartPayment(
      sourcing.tenantId,
      actorId,
      loadId,
      paymentId,
      decision,
      reason,
    );
    await this.step(sourcing, actorId, `shipper_payment_${decision}`, 'LS_PAYMENT_DECIDED', {
      paymentId,
      ...(reason ? { reason } : {}),
    });
    return payment;
  }

  /** "Payables pays the partner's balance, less any deductions" — from the original POD on. */
  async payPartnerBalance(
    actorId: string,
    loadId: string,
    input: { utrReference: string },
  ): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (!['original_pod_received', 'invoice_generated', 'payment'].includes(load.status)) {
        throw new ConflictError('No partner balance until the original POD is marked received');
      }
      if (await this.repository.findPartnerPayment(sourcing.id, 'balance')) {
        throw new ConflictError("The partner's balance is already paid");
      }
      const claim = await this.claimOf(loadId);
      const advance = await this.repository.findPartnerPayment(sourcing.id, 'advance');
      const amounts = partnerBalance({
        partnerTrip: this.partnerTrip(sourcing, load),
        approvedCharges: await this.repository.approvedChargesTotal(sourcing.tenantId, loadId),
        advanceGross: Number(advance?.grossAmount ?? 0),
        claimRecovery: Number(claim?.partnerRecovery ?? 0),
        tdsPercent: Number(sourcing.partner?.tdsPercent ?? DEFAULT_TDS_PERCENT),
      });
      if (amounts.net < 0) {
        throw new ValidationError(
          'Deductions exceed what is owed to the partner — settle it by hand',
        );
      }
      const payment = await this.repository.partnerPayments.save(
        this.repository.partnerPayments.create({
          sourcingId: sourcing.id,
          loadId,
          partnerId: sourcing.partnerId!,
          paymentType: 'balance',
          grossAmount: String(amounts.gross),
          tdsAmount: String(amounts.tds),
          deductionAmount: String(amounts.deductions),
          netAmount: String(amounts.net),
          utrReference: input.utrReference,
          paidBy: actorId,
          paidAt: this.now(),
        }),
      );
      const updated = await this.loadRepository.update(sourcing.tenantId, loadId, {
        partnerBalancePaidAt: this.now(),
        updatedBy: actorId,
      });
      await this.step(sourcing, actorId, 'partner_balance_paid', 'LS_PARTNER_PAID', {
        ...amounts,
        utrReference: input.utrReference,
      });
      if (updated) await this.stageService.closeIfReady(sourcing.tenantId, actorId, updated);
      return payment;
    } catch (error) {
      rethrow(error, "Failed to pay the partner's balance");
    }
  }
}
