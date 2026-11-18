import { DataSource, In } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { CodeSequenceRepository } from '../loads/code-sequence/code-sequence.repository';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadStageService } from '../loads/core/load-stage.service';
import { renderElrPdf } from '../loads/elr/elr-pdf';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentEntity } from '../loads/entities/load-payment.entity';
import { LoadPaymentRepository } from '../loads/payments/load-payment.repository';
import { istDateOf } from '../loads/verification/verification-rules';
import { SettingsReader } from '../settings/settings.types';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { LsCommercialTermsEntity } from './entities/ls-commercial-terms.entity';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsOriginalPodEntity } from './entities/ls-original-pod.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LsUnclaimedPaymentEntity } from './entities/ls-unclaimed-payment.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import {
  INVOICE_SETTLED_STATUSES,
  InvoiceSendChannel,
  LOADING_SIDE_HEADS,
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
import { attachPaymentProof } from './ls-payment-proof';
import {
  GstTreatment,
  PayerPodStatus,
  RECEIVABLE_LOAD_STATUSES,
  RECEIVABLE_STATUSES,
  ReceivableStatus,
  expectedAdvance,
  receivableStatus,
} from './receivables-rules';
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
  /** The payment advice, uploaded for purpose loads/payment-proof. */
  proofFileKey?: string;
}

/** "Record receipt" on a load (R01 drawer): the shipper's advance, or money against the invoice. */
export interface LoadReceiptInput {
  paymentType: 'advance' | 'balance';
  amount: number;
  receivedOn: string;
  utrReference: string;
  paidThrough?: ReceiptChannel;
  proofFileKey?: string;
  tdsCut?: number;
  shortfallReason?: ShortfallReason;
  shortfallNote?: string;
  /** A payment the shipper reported in the app that this receipt confirms. */
  loadPaymentId?: string;
}

/** The original POD sent on from Loadsmart to the balance payer. */
export interface PayerPodInput {
  status: Exclude<PayerPodStatus, 'not_sent'>;
  courierName?: string;
  docketNumber?: string;
  /** The IST date it went out / arrived; default today. */
  on?: string;
}

export interface ReceivablesBoardQuery {
  status?: ReceivableStatus[];
  tenantId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

/** Where the shipper's advance % comes from: its onboarding terms, the load as posted, or the
 *  settings' default. */
type AdvanceSource = 'terms' | 'load' | 'settings';

/** Everything the board and the load page compute from — gathered once per load. */
interface ReceivableFacts {
  sourcing: LsSourcingEntity;
  load: LoadEntity;
  shipperName: string | null;
  consignee: { name: string | null; city: string | null };
  route: { from: string | null; to: string | null };
  terms: LsCommercialTermsEntity | null;
  invoice: LsInvoiceEntity | null;
  originalPod: LsOriginalPodEntity | null;
  advancePayments: LoadPaymentEntity[];
  freight: number;
  approvedLoadingCharges: number;
  approvedCharges: number;
  advancePercent: number;
  advanceSource: AdvanceSource;
  advanceExpected: number;
  advanceReceived: number;
  status: ReceivableStatus;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const BOARD_CAP = 1000;

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
    /** Files a receipt's payment advice in the load's documents register. */
    private readonly loadDocumentService: LoadDocumentService | null = null,
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
  async preview(loadId: string, gstTreatment?: GstTreatment): Promise<InvoicePreview> {
    const sourcing = await this.assertWonLoad(loadId);
    return this.buildPreview(sourcing, gstTreatment);
  }

  async issue(actor: LoadsmartActor, loadId: string, gstTreatment?: GstTreatment) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (await this.repository.findInvoice(sourcing.tenantId, loadId)) {
        throw new ConflictError('This load is already invoiced');
      }
      const preview = await this.buildPreview(sourcing, gstTreatment);
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
          ...(await this.balancePayerOf(sourcing)),
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
      if (input.proofFileKey)
        await this.fileProof(actorId, invoice.tenantId, invoice.loadId, input.proofFileKey);
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

  // --- Receivables board and load page (R01) -------------------------------------------------

  /** Every Loadsmart load from the truck loaded to the shipper's money closing — one row each,
   *  with its status, the amount, who pays the balance and when — plus a count per status. */
  async board(query: ReceivablesBoardQuery) {
    const sourcings = await this.repository.sourcings.find({
      where: {
        status: 'won',
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        load: { status: In([...RECEIVABLE_LOAD_STATUSES]) },
      },
      relations: { load: { posting: true, requisition: { customerDeliveryPoint: true } } },
      order: { updatedAt: 'DESC' },
      take: BOARD_CAP,
    });
    const facts = await this.factsFor(sourcings);
    const q = query.q?.toLowerCase();
    const searched = q
      ? facts.filter((fact) =>
          [
            fact.load.code,
            fact.load.elrNumber,
            fact.shipperName,
            fact.consignee.name,
            fact.invoice?.invoiceNumber,
            fact.invoice?.payerPodDocket,
          ].some((value) => value?.toLowerCase().includes(q)),
        )
      : facts;
    const counts = Object.fromEntries(RECEIVABLE_STATUSES.map((status) => [status, 0])) as Record<
      ReceivableStatus,
      number
    >;
    for (const fact of searched) counts[fact.status] += 1;
    const shown = query.status?.length
      ? searched.filter((fact) => query.status!.includes(fact.status))
      : searched;
    const limit = Math.min(query.limit ?? 50, 200);
    const page = Math.max(query.page ?? 1, 1);
    return {
      total: shown.length,
      all: searched.length,
      counts,
      page,
      limit,
      items: shown.slice((page - 1) * limit, page * limit).map((fact) => this.boardRow(fact)),
    };
  }

  /** The load's receivables page: freight invoice, the shipper's agreement and who pays, charges,
   *  receipt history, and delivery / POD. */
  async loadDetail(loadId: string) {
    const sourcing = await this.repository.sourcings.findOne({
      where: { loadId },
      relations: { load: { posting: true, requisition: { customerDeliveryPoint: true } } },
    });
    if (!sourcing || sourcing.status !== 'won') {
      throw new NotFoundError(`Loadsmart load ${loadId} not found`);
    }
    const [fact] = await this.factsFor([sourcing]);
    const { load, invoice, terms } = fact;
    const [charges, payments, receipts, preview] = await Promise.all([
      this.repository.listCharges(sourcing.tenantId, loadId),
      this.loadPaymentRepository.listByLoad(sourcing.tenantId, loadId),
      invoice
        ? this.repository.receipts.find({
            where: { invoiceId: invoice.id },
            order: { createdAt: 'ASC' },
          })
        : Promise.resolve([]),
      invoice ? Promise.resolve(null) : this.buildPreview(sourcing),
    ]);
    const settings = (await this.settings.forLoad(load)).values;
    const balanceRemaining = invoice ? Number(invoice.openAmount ?? invoice.balanceDue) : null;
    return {
      ...this.boardRow(fact),
      agreement: {
        advancePayer: { type: 'shipper' as const, name: fact.shipperName },
        advancePercent: fact.advancePercent,
        advanceSource: fact.advanceSource,
        advanceExpected: fact.advanceExpected,
        advanceCalculation: `${fact.advancePercent}% of freight + shipper-approved loading charges`,
        balanceDueTermsDays:
          invoice?.creditDays ?? terms?.creditDays ?? settings.defaultShipperCreditDays,
        balancePaymentTrigger: terms?.podType ?? 'image',
        balancePayer: this.balancePayerView(fact),
        followUp: invoice ? (invoice.followUp ? 'follow_up' : 'invoiced') : 'not_yet_invoiced',
        billingInstructions: terms?.billingInstructions ?? [],
        billingNote: terms?.billingNote ?? null,
      },
      freightInvoice: {
        shipperFreight: fact.freight,
        approvedLoadingCharges: fact.approvedLoadingCharges,
        approvedCharges: fact.approvedCharges,
        freightPlusApprovedCharges: round2(fact.freight + fact.approvedCharges),
        gstTreatment: invoice?.gstSplit
          ? invoice.gstSplit.reverseCharge
            ? 'reverse_charge'
            : 'forward_charge'
          : null,
        defaultGstTreatment: settings.gstReverseCharge ? 'reverse_charge' : 'forward_charge',
        invoiceTotal: invoice ? Number(invoice.totalAmount) : null,
        advanceReceived: fact.advanceReceived,
        advanceRemaining: round2(Math.max(fact.advanceExpected - fact.advanceReceived, 0)),
        balanceRemaining,
        balanceDueDate: invoice?.dueDate ?? null,
        invoice: invoice
          ? {
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              fileKey: invoice.fileKey,
              sentVia: invoice.sentVia,
              receivedOn: invoice.receivedOn,
              createdAt: invoice.createdAt,
            }
          : null,
        // What still stops "Generate invoice" (empty once it can be issued).
        blockers: preview?.blockers ?? [],
      },
      charges: charges.map((charge) => ({
        id: charge.id,
        head: charge.chargeType,
        amount: Number(charge.amount),
        status: charge.status,
        paidWith: LOADING_SIDE_HEADS.includes(charge.chargeType) ? 'advance' : 'balance',
        includedInInvoice: charge.status === 'approved',
      })),
      receipts: [
        ...payments
          .filter((payment) => payment.paymentType === 'advance')
          .map((payment) => ({
            id: payment.id,
            paymentType: 'advance' as const,
            amount: Number(payment.amount),
            receivedOn: payment.paymentDate,
            utrReference: payment.utrReference,
            paidThrough: null,
            proofFileKey: payment.proofFileKey,
            verificationStatus: payment.verificationStatus,
            recordedAt: payment.createdAt,
          })),
        ...receipts.map((receipt) => ({
          id: receipt.id,
          paymentType: 'balance' as const,
          amount: Number(receipt.amount),
          receivedOn: receipt.receivedOn,
          utrReference: receipt.utrReference,
          paidThrough: receipt.paidThrough,
          proofFileKey: receipt.proofFileKey,
          verificationStatus: 'verified' as const,
          tdsCut: Number(receipt.tdsCut),
          shortfallReason: receipt.shortfallReason,
          recordedAt: receipt.createdAt,
        })),
      ].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()),
      // What the shipper reported paying in the app, waiting for Receivables to confirm.
      reportedPayments: payments.filter(
        (payment) =>
          payment.verificationStatus === 'pending' ||
          (payment.paymentType === 'advance' && payment.verificationStatus === null),
      ),
      delivery: {
        podImage: load.podFileKey ? 'submitted' : 'not_submitted',
        podStatus: load.podStatus,
        deliveredAt: load.deliveredAt,
        originalPod: {
          // The carrier's original reaching Loadsmart (Payables' tracker).
          atLoadsmart: this.originalAtLoadsmart(fact),
          trackerStatus: fact.originalPod?.status ?? null,
          // Then on to whoever pays the balance.
          toPayer: invoice?.payerPodStatus ?? 'not_sent',
          courierName: invoice?.payerPodCourier ?? null,
          docketNumber: invoice?.payerPodDocket ?? null,
          sentAt: invoice?.payerPodSentAt ?? null,
          receivedAt: invoice?.payerPodReceivedAt ?? null,
        },
        issue:
          load.shortageOrDamage && load.shortageOrDamage !== 'none' ? load.shortageOrDamage : null,
      },
    };
  }

  /** "Record receipt": the shipper's advance (from the truck loaded until the invoice — it is
   *  taken off the invoice), or money against the invoice once it is out. */
  async recordLoadReceipt(actor: LoadsmartActor, loadId: string, input: LoadReceiptInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      const invoice = await this.repository.findInvoice(sourcing.tenantId, loadId);

      if (input.paymentType === 'balance') {
        if (!invoice) {
          throw new ConflictError(
            'Generate the invoice first — the balance is received against it',
          );
        }
        await this.recordReceipt(actor.id, invoice.id, {
          amount: input.amount,
          receivedOn: input.receivedOn,
          paidThrough: input.paidThrough ?? 'company_account',
          utrReference: input.utrReference,
          tdsCut: input.tdsCut,
          shortfallReason: input.shortfallReason,
          shortfallNote: input.shortfallNote,
          loadPaymentId: input.loadPaymentId,
          proofFileKey: input.proofFileKey,
        });
        return this.loadDetail(loadId);
      }

      if (invoice) {
        throw new ConflictError(
          'The invoice is out and already takes the advance off — record this as a balance receipt',
        );
      }
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('The advance is due once the truck is loaded');
      }
      if (input.receivedOn > istDateOf(this.now())) {
        throw new ValidationError('The receipt date cannot be in the future');
      }
      const [fact] = await this.factsFor([sourcing]);
      if (fact.advanceExpected <= 0) {
        throw new ConflictError('No advance is agreed with this shipper');
      }
      if (fact.advanceReceived + 0.005 >= fact.advanceExpected) {
        throw new ConflictError('The advance is already received in full');
      }
      if (input.proofFileKey) {
        await this.fileProof(actor.id, sourcing.tenantId, loadId, input.proofFileKey);
      }
      const now = this.now();
      let paymentId: string;
      if (input.loadPaymentId) {
        // Confirms the advance the shipper reported in the app.
        const reported = await this.loadPaymentRepository.findById(
          sourcing.tenantId,
          loadId,
          input.loadPaymentId,
        );
        if (!reported || reported.paymentType !== 'advance') {
          throw new NotFoundError('That reported advance is not on this load');
        }
        const verified = await this.loadPaymentRepository.markReportedVerified(
          sourcing.tenantId,
          reported.id,
          actor.id,
          now,
        );
        if (!verified) throw new ConflictError('That reported advance is already checked');
        paymentId = reported.id;
      } else {
        const payment = await this.loadPaymentRepository.create({
          tenantId: sourcing.tenantId,
          loadId,
          transporterId: null,
          paymentType: 'advance',
          amount: input.amount.toFixed(2),
          utrReference: input.utrReference.trim(),
          proofFileKey: input.proofFileKey ?? null,
          paymentDate: input.receivedOn,
          verificationStatus: 'verified',
          verifiedBy: actor.id,
          verifiedAt: now,
          recordedBy: actor.id,
        });
        paymentId = payment.id;
      }
      if (!load.advancePaidAt) {
        await this.loadRepository.update(sourcing.tenantId, loadId, {
          advancePaidAt: now,
          updatedBy: actor.id,
        });
      }
      await this.loadActivityService.record(
        sourcing.tenantId,
        loadId,
        actor.id,
        'PAYMENT_RECORDED',
        null,
        'advance',
        { amount: input.amount, utrReference: input.utrReference, by: 'loadsmart_receivables' },
      );
      await this.auditService.log({
        tenantId: sourcing.tenantId,
        userId: actor.id,
        action: 'LS_RECEIPT_RECORDED',
        resourceType: 'load_payment',
        newData: { id: paymentId, loadId, paymentType: 'advance', amount: input.amount },
      });
      return this.loadDetail(loadId);
    } catch (error) {
      rethrow(error, 'Failed to record the receipt');
    }
  }

  /** The original POD on its way from Loadsmart to whoever pays the balance: sent (courier and
   *  docket), then received. Only for shippers billed on the original. */
  async recordPayerPod(actorId: string, invoiceId: string, input: PayerPodInput) {
    try {
      const invoice = await this.assertInvoice(invoiceId);
      const terms = await this.repository.terms.findOneBy({ tenantId: invoice.tenantId });
      if (terms?.podType !== 'original') {
        throw new ConflictError(
          'This shipper is billed on the POD image — no original goes to them',
        );
      }
      if (input.status === 'in_transit' && invoice.payerPodStatus === 'received') {
        throw new ConflictError('The payer already has the original POD');
      }
      const today = istDateOf(this.now());
      if (input.on && input.on > today) {
        throw new ValidationError('The date cannot be in the future');
      }
      const at = input.on ? new Date(`${input.on}T12:00:00+05:30`) : this.now();
      await this.repository.invoices.update(
        { id: invoice.id },
        input.status === 'in_transit'
          ? {
              payerPodStatus: 'in_transit',
              payerPodSentAt: at,
              ...(input.courierName ? { payerPodCourier: input.courierName } : {}),
              ...(input.docketNumber ? { payerPodDocket: input.docketNumber } : {}),
            }
          : {
              payerPodStatus: 'received',
              payerPodReceivedAt: at,
              ...(invoice.payerPodSentAt ? {} : { payerPodSentAt: at }),
              ...(input.courierName ? { payerPodCourier: input.courierName } : {}),
              ...(input.docketNumber ? { payerPodDocket: input.docketNumber } : {}),
            },
      );
      await this.auditService.log({
        tenantId: invoice.tenantId,
        userId: actorId,
        action: 'LS_PAYER_POD_UPDATED',
        resourceType: 'ls_invoice',
        oldData: { id: invoice.id, payerPodStatus: invoice.payerPodStatus },
        newData: { id: invoice.id, ...input },
      });
      return this.loadDetail(invoice.loadId);
    } catch (error) {
      rethrow(error, 'Failed to update the original POD');
    }
  }

  /** Gathers what the board and the load page need for these loads, a few queries for all. */
  private async factsFor(sourcings: LsSourcingEntity[]): Promise<ReceivableFacts[]> {
    if (!sourcings.length) return [];
    const loadIds = sourcings.map((sourcing) => sourcing.loadId);
    const tenantIds = [...new Set(sourcings.map((sourcing) => sourcing.tenantId))];
    const [invoices, termsRows, orgs, originalPods, charges, payments] = await Promise.all([
      this.repository.invoices.findBy({ loadId: In(loadIds) }),
      this.repository.terms.findBy({ tenantId: In(tenantIds) }),
      this.dataSource
        .getRepository(OrganizationEntity)
        .find({ where: { id: In(tenantIds) }, select: { id: true, name: true } }),
      this.repository.originalPods.findBy({ loadId: In(loadIds) }),
      this.repository.charges.findBy({ loadId: In(loadIds), status: 'approved' }),
      this.dataSource
        .getRepository(LoadPaymentEntity)
        .findBy({ loadId: In(loadIds), paymentType: 'advance' }),
    ]);
    const facts: ReceivableFacts[] = [];
    for (const sourcing of sourcings) {
      const load = sourcing.load;
      const terms = termsRows.find((row) => row.tenantId === sourcing.tenantId) ?? null;
      const invoice = invoices.find((row) => row.loadId === load.id) ?? null;
      const originalPod = originalPods.find((row) => row.loadId === load.id) ?? null;
      const loadCharges = charges.filter((charge) => charge.loadId === load.id);
      const approvedCharges = round2(
        loadCharges.reduce((sum, charge) => sum + Number(charge.amount), 0),
      );
      const approvedLoadingCharges = round2(
        loadCharges
          .filter((charge) => LOADING_SIDE_HEADS.includes(charge.chargeType))
          .reduce((sum, charge) => sum + Number(charge.amount), 0),
      );
      const freight = load.freightValue
        ? tripAmount(
            Number(load.freightValue),
            load.freightType,
            Number(load.plannedCapacityTonnes),
          )
        : 0;
      const settings = (await this.settings.forLoad(load)).values;
      const { percent, source } = advancePercentOf(
        terms,
        load,
        settings.defaultShipperAdvancePercent,
      );
      const advancePayments = payments.filter(
        (payment) => payment.loadId === load.id && payment.verificationStatus !== 'rejected',
      );
      const advanceReceived = round2(
        advancePayments
          .filter((payment) => payment.verificationStatus !== 'pending')
          .reduce((sum, payment) => sum + Number(payment.amount), 0),
      );
      const advanceExpected = invoice
        ? Number(invoice.advanceReceived) ||
          expectedAdvance(percent, freight, approvedLoadingCharges)
        : expectedAdvance(percent, freight, approvedLoadingCharges);
      const fact: ReceivableFacts = {
        sourcing,
        load,
        shipperName: orgs.find((org) => org.id === sourcing.tenantId)?.name ?? null,
        consignee: consigneeOf(load),
        route: {
          from: load.posting?.pickupAddress?.city ?? null,
          to:
            load.posting?.dropAddress?.city ??
            load.requisition?.customerDeliveryPoint?.city ??
            null,
        },
        terms,
        invoice,
        originalPod,
        advancePayments,
        freight,
        approvedLoadingCharges,
        approvedCharges,
        advancePercent: percent,
        advanceSource: source,
        advanceExpected,
        advanceReceived,
        status: 'advance_due',
      };
      fact.status = receivableStatus({
        loadStatus: load.status,
        podIn: Boolean(load.podFileKey),
        invoiceStatus: invoice?.status ?? null,
        needsOriginalPod: terms?.podType === 'original',
        originalPodAtLoadsmart: this.originalAtLoadsmart(fact),
        payerPodStatus: invoice?.payerPodStatus ?? 'not_sent',
        advanceExpected,
        advanceReceived,
      });
      facts.push(fact);
    }
    return facts;
  }

  private boardRow(fact: ReceivableFacts) {
    const { load, invoice } = fact;
    return {
      loadId: load.id,
      code: load.code,
      lrNumber: load.elrNumber,
      loadStatus: load.status,
      tenantId: fact.sourcing.tenantId,
      shipperName: fact.shipperName,
      route: fact.route,
      invoice: invoice
        ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: invoice.status }
        : null,
      // The invoice total once it is out; before that freight + approved charges.
      amount: invoice ? Number(invoice.totalAmount) : round2(fact.freight + fact.approvedCharges),
      balancePayer: this.balancePayerView(fact),
      balanceDueDate: invoice?.dueDate ?? null,
      status: fact.status,
    };
  }

  private balancePayerView(fact: ReceivableFacts) {
    const type = fact.invoice?.balancePayer ?? fact.terms?.balancePayer ?? 'shipper';
    return {
      type,
      name:
        fact.invoice?.balancePayerName ??
        (type === 'consignee'
          ? [fact.shipperName, fact.consignee.name].filter(Boolean).join(' · ') || null
          : fact.shipperName),
    };
  }

  /** Who the invoice's balance is collected from, as the shipper's terms say when it is issued. */
  private async balancePayerOf(sourcing: LsSourcingEntity) {
    const [fact] = await this.factsFor([
      (await this.repository.sourcings.findOne({
        where: { id: sourcing.id },
        relations: { load: { posting: true, requisition: { customerDeliveryPoint: true } } },
      }))!,
    ]);
    const view = this.balancePayerView({ ...fact, invoice: null });
    return { balancePayer: view.type, balancePayerName: view.name };
  }

  private originalAtLoadsmart(fact: Pick<ReceivableFacts, 'load' | 'originalPod'>): boolean {
    return (
      Boolean(fact.load.originalPodReceivedAt) || fact.originalPod?.status === 'received_filed'
    );
  }

  /** Adopts the payment advice the staff member uploaded and files it on the load. */
  private async fileProof(actorId: string, tenantId: string, loadId: string, fileKey: string) {
    if (!this.loadDocumentService) {
      throw new ConflictError('Payment advice files are not available on this server');
    }
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    await attachPaymentProof(
      this.storageService,
      this.loadDocumentService,
      actorId,
      tenantId,
      load,
      fileKey,
    );
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
        proofFileKey: input.proofFileKey ?? null,
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

  private async buildPreview(
    sourcing: LsSourcingEntity,
    gstTreatment?: GstTreatment,
  ): Promise<InvoicePreview> {
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
            // The invoice's own choice, else Settings' default.
            reverseCharge: gstTreatment
              ? gstTreatment === 'reverse_charge'
              : settings.gstReverseCharge,
            loadsmartStateCode: settings.loadsmartGstStateCode,
            shipperStateCode: shipperState,
            advanceReceived: payments
              .filter(
                (payment) =>
                  payment.paymentType === 'advance' && payment.verificationStatus !== 'rejected',
              )
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

/** The shipper's advance %: its onboarding terms, else what the load was posted with, else the
 *  settings' default. */
function advancePercentOf(
  terms: LsCommercialTermsEntity | null,
  load: LoadEntity,
  settingsDefault: number,
): { percent: number; source: AdvanceSource } {
  if (terms?.shipperAdvancePercent != null) {
    return { percent: Number(terms.shipperAdvancePercent), source: 'terms' };
  }
  if (load.advancePercentage != null) {
    return { percent: Number(load.advancePercentage), source: 'load' };
  }
  return { percent: settingsDefault, source: 'settings' };
}

/** The drop — the consignee who may pay the balance. */
function consigneeOf(load: LoadEntity): { name: string | null; city: string | null } {
  const point = load.requisition?.customerDeliveryPoint;
  if (point) return { name: point.location, city: point.city ?? null };
  const drop = load.posting?.dropAddress;
  return { name: drop?.label ?? null, city: drop?.city ?? null };
}
