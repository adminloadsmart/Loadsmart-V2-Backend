import { DataSource, In } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { CodeSequenceRepository } from '../loads/code-sequence/code-sequence.repository';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadStageService } from '../loads/core/load-stage.service';
import { renderElrPdf } from '../loads/elr/elr-pdf';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentRepository } from '../loads/payments/load-payment.repository';
import { istDateOf } from '../loads/verification/verification-rules';
import { SettingsReader } from '../settings/settings.types';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LsUnclaimedPaymentEntity } from './entities/ls-unclaimed-payment.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import {
  INVOICE_SETTLED_STATUSES,
  InvoiceSendChannel,
  LOADSMART_SEQUENCE_SCOPE,
  PaymentModeIn,
  ReceiptChannel,
  ShortfallReason,
  UnclaimedStatus,
} from './loadsmart.types';
import {
  AGEING_BUCKETS,
  AgeingBucket,
  InvoiceDraft,
  ageingBucket,
  buildInvoiceDraft,
  daysBetween,
  dueDateFrom,
  reconcile,
} from './billing-rules';
import { tripAmount } from './loadsmart-rules';
import { LsServiceBase } from './ls-base';
import { LoadsmartActor } from './loadsmart.interface';

const INVOICE_NUMBER_OFFSET = 1000;
const rupees = (value: string | number) => `₹${Number(value).toFixed(2)}`;

export interface InvoiceDeliveryInput {
  via?: InvoiceSendChannel;
  /** The shipper's receipt date (IST). Sent in the app: received the same day. */
  receivedOn?: string;
}

export interface ReceiptInput {
  amount: number;
  receivedOn: string;
  paidThrough: ReceiptChannel;
  utrReference?: string;
  tdsCut?: number;
  shortfallReason?: ShortfallReason;
  shortfallNote?: string;
  /** The payment the shipper reported in the app that this receipt verifies. */
  loadPaymentId?: string;
}

export interface UnclaimedInput {
  amount: number;
  payerName: string;
  mode: PaymentModeIn;
  utrReference?: string;
  remitterBank?: string;
  receivedOn: string;
  remark?: string;
}

/** What the builder shows before issuing: the draft and what still stops it. */
export interface InvoicePreview {
  draft: InvoiceDraft | null;
  creditDays: number;
  blockers: string[];
}

/**
 * Receivables (R01–R03): bills the shipper on the POD image, records receipts against the bank,
 * reconciles each invoice and works unclaimed payments. Carrier rates are never shown here. No
 * email, WhatsApp or reminders are sent from this build — sending is recorded, not done.
 */
export class LsReceivablesService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly stageService: LoadStageService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly storageService: StorageService,
    private readonly settings: SettingsReader,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  // --- Inbox (R01) ---------------------------------------------------------------------------

  async inbox() {
    const today = istDateOf(this.now());
    const delivered = await this.repository.listLoadsAt(['delivered_ok', 'delivered_with_issues']);
    const toInvoice = [];
    for (const sourcing of delivered) {
      const load = sourcing.load;
      if (load.podStatus !== 'accepted' || !load.deliveredAt) continue;
      if (await this.repository.findInvoice(sourcing.tenantId, load.id)) continue;
      const [terms, settings] = await Promise.all([
        this.repository.terms.findOneBy({ tenantId: sourcing.tenantId }),
        this.settings.forLoad(load),
      ]);
      const days = daysBetween(istDateOf(load.deliveredAt), today);
      toInvoice.push({
        load: this.shipperView(load),
        deliveredDays: days,
        late: days > settings.values.invoiceTargetDays,
        // "Shippers who pay on the original POD wait for it."
        waitingForOriginalPod: terms?.podType === 'original' && !load.originalPodReceivedAt,
      });
    }

    const open = await this.repository.invoices.find({
      where: { status: In(['issued', 'partly_paid', 'excess']) },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    const ageing = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0])) as Record<
      AgeingBucket,
      number
    >;
    let totalOpen = 0;
    for (const invoice of open) {
      const amount = Number(invoice.openAmount ?? invoice.balanceDue);
      if (amount <= 0) continue;
      totalOpen += amount;
      ageing[ageingBucket(invoice.dueDate, today)] += amount;
    }
    return {
      toInvoice,
      overdue: open.filter(
        (invoice) =>
          invoice.status !== 'excess' && invoice.dueDate !== null && invoice.dueDate < today,
      ),
      shortOrExcess: open.filter(
        (invoice) => invoice.status === 'partly_paid' || invoice.status === 'excess',
      ),
      notReceived: open.filter((invoice) => !invoice.receivedOn),
      unclaimedPayments: await this.repository.unclaimed.count({
        where: { status: In(['unclaimed', 'under_review']) },
      }),
      totalOpen: Math.round(totalOpen * 100) / 100,
      ageing,
    };
  }

  // --- Invoice builder (R02) -----------------------------------------------------------------

  /** The draft as it would be issued now, with anything that stops it. */
  async preview(loadId: string): Promise<InvoicePreview> {
    const sourcing = await this.assertWonLoad(loadId);
    return this.buildPreview(sourcing);
  }

  async issue(actor: LoadsmartActor, loadId: string) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (await this.repository.findInvoice(sourcing.tenantId, loadId)) {
        throw new ConflictError('This load is already invoiced');
      }
      const preview = await this.buildPreview(sourcing);
      if (preview.blockers.length || !preview.draft) {
        throw new ConflictError(`Not ready to invoice: ${preview.blockers.join('; ')}`);
      }
      const draft = preview.draft;
      const sequence = await this.dataSource.transaction((manager) =>
        this.codeSequenceRepository.next('ls_invoice', LOADSMART_SEQUENCE_SCOPE, manager),
      );
      const invoiceNumber = `LSI-${INVOICE_NUMBER_OFFSET + sequence}`;
      const now = this.now();
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
              { label: 'LR', value: load.elrNumber ?? '—' },
              { label: 'Vehicle', value: load.vehicleNumber ?? '—' },
              { label: 'Shipper invoice', value: load.invoiceNumber ?? '—' },
            ],
          },
          {
            heading: 'Amounts',
            rows: [
              ...draft.lines.map((line) => ({
                label: line.notBilled ? `${line.label} (not billed)` : line.label,
                value: rupees(line.amount),
              })),
              { label: 'Taxable value', value: rupees(draft.taxable) },
              ...(draft.split.interState
                ? [{ label: `IGST ${draft.gstPercent}%`, value: rupees(draft.split.igst) }]
                : [
                    { label: `CGST ${draft.gstPercent / 2}%`, value: rupees(draft.split.cgst) },
                    { label: `SGST ${draft.gstPercent / 2}%`, value: rupees(draft.split.sgst) },
                  ]),
              ...(draft.split.reverseCharge
                ? [{ label: 'GST payable by', value: 'Recipient (reverse charge)' }]
                : []),
              { label: 'Invoice total', value: rupees(draft.total) },
              { label: 'Advance received', value: `− ${rupees(draft.advanceReceived)}` },
              { label: 'Balance due', value: rupees(draft.balanceDue) },
              { label: 'Terms', value: `${preview.creditDays} days from receipt` },
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
          freightAmount: String(draft.lines[0].amount),
          chargesAmount: String(draft.charges),
          // Claims come off as credit notes, never on the invoice.
          claimCredit: '0',
          taxableAmount: String(draft.taxable),
          gstPercent: String(draft.gstPercent),
          gstAmount: String(draft.gst),
          totalAmount: String(draft.total),
          advanceReceived: String(draft.advanceReceived),
          balanceDue: String(draft.balanceDue),
          openAmount: String(draft.balanceDue),
          dueDate: null,
          status: 'issued',
          lines: draft.lines,
          gstSplit: draft.split,
          creditDays: preview.creditDays,
          fileKey: file.key,
          issuedBy: actor.id,
        }),
      );
      await this.stageService.transition({
        tenantId: sourcing.tenantId,
        loadId,
        trigger: 'invoice_issued',
        actorType: 'ls_team',
        actorId: actor.id,
        load,
        auditAction: 'LS_INVOICE_GENERATED',
        metadata: { invoiceNumber, balanceDue: draft.balanceDue },
      });
      // Credit notes already issued (a claim closed before billing) count at once.
      return await this.refreshInvoice(actor.id, invoice);
    } catch (error) {
      rethrow(error, 'Failed to issue the invoice');
    }
  }

  /** How the invoice went and when the shipper received it — "receipt date sets the due date". */
  async recordDelivery(actorId: string, invoiceId: string, input: InvoiceDeliveryInput) {
    try {
      const invoice = await this.assertInvoice(invoiceId);
      if (input.via === undefined && input.receivedOn === undefined) {
        throw new ValidationError('Say how it was sent or when the shipper received it');
      }
      const now = this.now();
      const receivedOn =
        input.receivedOn ?? (input.via === 'app' ? istDateOf(now) : invoice.receivedOn);
      if (receivedOn && receivedOn > istDateOf(now)) {
        throw new ValidationError('The receipt date cannot be in the future');
      }
      await this.repository.invoices.update(
        { id: invoice.id },
        {
          ...(input.via ? { sentVia: input.via, sentAt: now } : {}),
          ...(receivedOn
            ? { receivedOn, dueDate: dueDateFrom(receivedOn, invoice.creditDays ?? 0) }
            : {}),
        },
      );
      await this.auditService.log({
        tenantId: invoice.tenantId,
        userId: actorId,
        action: 'LS_INVOICE_SENT',
        resourceType: 'ls_invoice',
        newData: { id: invoice.id, ...input, receivedOn },
      });
      return (await this.repository.invoices.findOneBy({ id: invoice.id }))!;
    } catch (error) {
      rethrow(error, 'Failed to record the invoice delivery');
    }
  }

  // --- Receipts and reconciliation (R03) -----------------------------------------------------

  async listReceipts(invoiceId: string) {
    const invoice = await this.assertInvoice(invoiceId);
    const [receipts, creditNotes, reported] = await Promise.all([
      this.repository.receipts.find({ where: { invoiceId }, order: { createdAt: 'ASC' } }),
      this.repository.creditNotes.findBy({ loadId: invoice.loadId }),
      this.loadPaymentRepository.listByLoad(invoice.tenantId, invoice.loadId),
    ]);
    return {
      invoice,
      receipts,
      creditNotes,
      // What the shipper reported paying in the app, waiting to be matched.
      reportedPayments: reported.filter((payment) => payment.paymentType === 'balance'),
    };
  }

  async recordReceipt(actorId: string, invoiceId: string, input: ReceiptInput) {
    try {
      const invoice = await this.assertInvoice(invoiceId);
      if (INVOICE_SETTLED_STATUSES.includes(invoice.status) && invoice.status !== 'excess') {
        throw new ConflictError(`This invoice is already ${invoice.status.replace('_', ' ')}`);
      }
      if (input.shortfallReason === 'other' && !input.shortfallNote?.trim()) {
        throw new ValidationError('Add a note for a shortfall under "other"');
      }
      if (input.loadPaymentId) {
        const payment = await this.loadPaymentRepository.findById(
          invoice.tenantId,
          invoice.loadId,
          input.loadPaymentId,
        );
        if (!payment) throw new NotFoundError('That reported payment is not on this load');
        if (payment.verificationStatus !== 'pending') {
          throw new ConflictError('That reported payment is already matched');
        }
      }
      return await this.saveReceipt(actorId, invoice, input, null);
    } catch (error) {
      rethrow(error, 'Failed to record the receipt');
    }
  }

  // --- Unclaimed payments --------------------------------------------------------------------

  listUnclaimed(statuses: UnclaimedStatus[]): Promise<LsUnclaimedPaymentEntity[]> {
    return this.repository.unclaimed.find({
      where: { status: In(statuses) },
      order: { receivedOn: 'ASC' },
    });
  }

  async addUnclaimed(actorId: string, input: UnclaimedInput) {
    const now = this.now().toISOString();
    return this.repository.unclaimed.save(
      this.repository.unclaimed.create({
        amount: String(input.amount),
        payerName: input.payerName,
        mode: input.mode,
        utrReference: input.utrReference ?? null,
        remitterBank: input.remitterBank ?? null,
        receivedOn: input.receivedOn,
        createdBy: actorId,
        remarks: input.remark ? [{ at: now, by: actorId, text: input.remark }] : [],
      }),
    );
  }

  /** A remark, and optionally under review or refunded to the payer. */
  async updateUnclaimed(
    actorId: string,
    id: string,
    input: { status?: 'under_review' | 'refunded'; remark: string },
  ) {
    const row = await this.assertUnclaimed(id);
    await this.repository.unclaimed.update(
      { id },
      {
        ...(input.status ? { status: input.status } : {}),
        remarks: [
          ...row.remarks,
          { at: this.now().toISOString(), by: actorId, text: input.remark },
        ],
      },
    );
    return (await this.repository.unclaimed.findOneBy({ id }))!;
  }

  /** "Matched to invoice": the money becomes a receipt on that invoice. */
  async matchUnclaimed(
    actorId: string,
    id: string,
    input: { invoiceId: string; paidThrough: ReceiptChannel; tdsCut?: number; remark?: string },
  ) {
    try {
      const row = await this.assertUnclaimed(id);
      const invoice = await this.assertInvoice(input.invoiceId);
      const result = await this.saveReceipt(
        actorId,
        invoice,
        {
          amount: Number(row.amount),
          receivedOn: row.receivedOn,
          paidThrough: input.paidThrough,
          utrReference: row.utrReference ?? undefined,
          tdsCut: input.tdsCut,
        },
        row.id,
      );
      await this.repository.unclaimed.update(
        { id },
        {
          status: 'matched',
          matchedInvoiceId: invoice.id,
          remarks: [
            ...row.remarks,
            {
              at: this.now().toISOString(),
              by: actorId,
              text: input.remark ?? `Matched to ${invoice.invoiceNumber}`,
            },
          ],
        },
      );
      return result;
    } catch (error) {
      rethrow(error, 'Failed to match the payment');
    }
  }

  // --- Shared --------------------------------------------------------------------------------

  /** LoadsmartBilling for LoadPaymentService — what the shipper still owes on the invoice. */
  balanceDueOf = async (tenantId: string, loadId: string): Promise<string | null> => {
    const invoice = await this.repository.findInvoice(tenantId, loadId);
    return invoice ? (invoice.openAmount ?? invoice.balanceDue) : null;
  };

  /** Re-reconcile after a credit note (CS closed a claim on a billed load). */
  async refreshForLoad(actorId: string, tenantId: string, loadId: string) {
    const invoice = await this.repository.findInvoice(tenantId, loadId);
    if (invoice) await this.refreshInvoice(actorId, invoice);
  }

  private async saveReceipt(
    actorId: string,
    invoice: LsInvoiceEntity,
    input: ReceiptInput,
    unclaimedPaymentId: string | null,
  ) {
    const receipt = await this.repository.receipts.save(
      this.repository.receipts.create({
        tenantId: invoice.tenantId,
        loadId: invoice.loadId,
        invoiceId: invoice.id,
        amount: String(input.amount),
        receivedOn: input.receivedOn,
        paidThrough: input.paidThrough,
        utrReference: input.utrReference ?? null,
        tdsCut: String(input.tdsCut ?? 0),
        shortfallReason: input.shortfallReason ?? null,
        shortfallNote: input.shortfallNote?.trim() || null,
        loadPaymentId: input.loadPaymentId ?? null,
        unclaimedPaymentId,
        recordedBy: actorId,
      }),
    );
    if (input.loadPaymentId) {
      await this.loadPaymentRepository.markVerified(
        invoice.tenantId,
        input.loadPaymentId,
        actorId,
        this.now(),
      );
    }
    const refreshed = await this.refreshInvoice(actorId, invoice);
    await this.auditService.log({
      tenantId: invoice.tenantId,
      userId: actorId,
      action: 'LS_RECEIPT_RECORDED',
      resourceType: 'ls_invoice',
      newData: {
        id: invoice.id,
        receiptId: receipt.id,
        amount: receipt.amount,
        status: refreshed.status,
      },
    });
    return { receipt, invoice: refreshed };
  }

  /** Reconcile the invoice; on the first money in the load moves to Payment, and once the shipper
   *  is settled the load closes if the carrier is paid too. */
  private async refreshInvoice(
    actorId: string,
    invoice: LsInvoiceEntity,
  ): Promise<LsInvoiceEntity> {
    const [receipts, credited] = await Promise.all([
      this.repository.receipts.findBy({ invoiceId: invoice.id }),
      this.repository.creditNotesTotal(invoice.loadId),
    ]);
    const result = reconcile({
      balanceDue: Number(invoice.balanceDue),
      receipts: receipts.map((receipt) => ({
        amount: Number(receipt.amount),
        tdsCut: Number(receipt.tdsCut),
        shortfallReason: receipt.shortfallReason,
      })),
      creditNotes: credited,
    });
    const settled = INVOICE_SETTLED_STATUSES.includes(result.status);
    const now = this.now();
    await this.repository.invoices.update(
      { id: invoice.id },
      {
        status: result.status,
        openAmount: String(result.gap),
        followUp: result.followUp,
        settledAt: settled ? (invoice.settledAt ?? now) : null,
      },
    );
    let load = await this.loadRepository.findById(invoice.tenantId, invoice.loadId);
    if (load && receipts.length && load.status === 'invoice_generated') {
      load = await this.stageService.transition({
        tenantId: invoice.tenantId,
        loadId: load.id,
        trigger: 'payment_recorded',
        actorType: 'ls_team',
        actorId,
        load,
        metadata: { invoiceNumber: invoice.invoiceNumber },
      });
    }
    if (load && settled && !load.balancePaidAt) {
      const updated = await this.loadRepository.update(invoice.tenantId, load.id, {
        balancePaidAt: now,
        updatedBy: actorId,
      });
      if (updated) await this.stageService.closeIfReady(invoice.tenantId, actorId, updated);
    }
    return (await this.repository.invoices.findOneBy({ id: invoice.id }))!;
  }

  private async buildPreview(sourcing: LsSourcingEntity): Promise<InvoicePreview> {
    const load = sourcing.load;
    const [terms, resolved, charges, payments, shipperState] = await Promise.all([
      this.repository.terms.findOneBy({ tenantId: sourcing.tenantId }),
      this.settings.forLoad(load),
      this.repository.listCharges(sourcing.tenantId, load.id),
      this.loadPaymentRepository.listByLoad(sourcing.tenantId, load.id),
      this.repository.shipperGstStateCode(sourcing.tenantId),
    ]);
    const settings = resolved.values;
    const blockers: string[] = [];
    if (load.status !== 'delivered_ok' && load.status !== 'delivered_with_issues') {
      blockers.push('the load is not delivered');
    }
    if (load.podStatus !== 'accepted') blockers.push('the POD image is not approved');
    const undecided = charges.filter(
      (charge) => charge.status === 'raised' || charge.status === 'queried',
    );
    if (undecided.length)
      blockers.push(`${undecided.length} charge(s) still waiting for the shipper`);
    if (terms?.podType === 'original' && !load.originalPodReceivedAt) {
      blockers.push('this shipper is billed on the original POD, which is not in yet');
    }
    if (!shipperState) blockers.push("the shipper's GSTIN is not on file");
    if (!load.freightValue) blockers.push('no shipper price on the load');
    const creditDays = Math.min(
      terms?.creditDays ?? settings.defaultShipperCreditDays,
      settings.maxShipperCreditDays,
    );
    const draft =
      shipperState && load.freightValue
        ? buildInvoiceDraft({
            freight: {
              label: this.freightLabel(load),
              amount: tripAmount(
                Number(load.freightValue),
                load.freightType,
                Number(load.plannedCapacityTonnes),
              ),
            },
            charges: charges
              .filter((charge) => charge.status === 'approved')
              .map((charge) => ({ head: charge.chargeType, amount: Number(charge.amount) })),
            instructions: terms?.billingInstructions ?? [],
            gstPercent: settings.gstPercent,
            reverseCharge: settings.gstReverseCharge,
            loadsmartStateCode: settings.loadsmartGstStateCode,
            shipperStateCode: shipperState,
            advanceReceived: payments
              .filter((payment) => payment.paymentType === 'advance')
              .reduce((sum, payment) => sum + Number(payment.amount), 0),
          })
        : null;
    return { draft, creditDays, blockers };
  }

  private freightLabel(load: LoadEntity): string {
    return [
      `Transportation — ${load.code}`,
      load.elrNumber ? `LR ${load.elrNumber}` : null,
      load.vehicleNumber,
      load.invoiceNumber ? `shipper invoice ${load.invoiceNumber}` : null,
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Receivables sees shipper money only. */
  private shipperView(load: LoadEntity) {
    return {
      id: load.id,
      code: load.code,
      tenantId: load.tenantId,
      status: load.status,
      vehicleNumber: load.vehicleNumber,
      deliveredAt: load.deliveredAt,
      freightValue: load.freightValue,
      freightType: load.freightType,
    };
  }

  private async assertInvoice(id: string): Promise<LsInvoiceEntity> {
    const invoice = await this.repository.invoices.findOneBy({ id });
    if (!invoice) throw new NotFoundError(`Invoice ${id} not found`);
    return invoice;
  }

  private async assertUnclaimed(id: string): Promise<LsUnclaimedPaymentEntity> {
    const row = await this.repository.unclaimed.findOneBy({ id });
    if (!row) throw new NotFoundError(`Payment ${id} not found`);
    if (row.status === 'matched' || row.status === 'refunded') {
      throw new ConflictError(`This payment is already ${row.status}`);
    }
    return row;
  }
}
