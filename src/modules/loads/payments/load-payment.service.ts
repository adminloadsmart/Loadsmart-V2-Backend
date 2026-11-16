import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { StorageService } from '../../storage/storage.service';
import { LoadDocumentService } from '../documents/load-document.service';
import { assertConfirmedUpload } from '../documents/upload-check';
import { LoadChargeService } from '../money/load-charge.service';
import { moneySummary, PaymentHeads, paymentProofError, sumHeads } from '../money/money-rules';
import { AuditService } from '../../audit/audit.service';
import { TransporterService } from '../../masters/transporter/transporter.service';
import { toDateString } from '../../../shared/utils/date';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadRepository } from '../core/load.repository';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadStageService } from '../core/load-stage.service';
import { LoadEntity } from '../entities/load.entity';
import { LoadPaymentEntity } from '../entities/load-payment.entity';
import {
  RecordAdvanceInput,
  RecordBalanceInput,
  LoadsmartBilling,
} from '../utils/load-payment.interface';

export function computeShareAmount(load: LoadEntity, percentage: string): string {
  const pct = Number(percentage) / 100;
  const freightValue = Number(load.freightValue ?? 0);
  const base =
    load.freightType === 'flat' ? freightValue : freightValue * Number(load.plannedCapacityTonnes);
  return (base * pct).toFixed(2);
}

export class LoadPaymentService {
  private loadsmartBilling?: LoadsmartBilling;

  setLoadsmartBilling(billing: LoadsmartBilling): void {
    this.loadsmartBilling = billing;
  }

  constructor(
    private readonly repository: LoadPaymentRepository,
    private readonly loadRepository: LoadRepository,
    private readonly transporterService: TransporterService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly stageService: LoadStageService,
    private readonly charges: LoadChargeService,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
  ) {}

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  /** The advance — own transporter / indent (and Loadsmart), once the load is Loaded. "Paid
   *  outside Loadsmart; recorded for the load's accounts": the amount (the advance share of the
   *  freight unless given), UTR, the account it was paid from, NEFT or UPI, and an optional
   *  proof. */
  async recordAdvance(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: RecordAdvanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType === 'own_fleet') {
        throw new ConflictError('Advance payment applies to market and indent loads only');
      }
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('Advance can only be recorded once the load is loaded');
      }
      if (load.advancePaidAt) {
        throw new ConflictError('Advance has already been recorded for this load');
      }
      if (input.proofFileKey) {
        await assertConfirmedUpload(
          this.storageService,
          tenantId,
          actorRole,
          input.proofFileKey,
          'loads/payment-proof',
        );
      }

      const amount =
        input.amount !== undefined
          ? input.amount.toFixed(2)
          : computeShareAmount(load, load.advancePercentage ?? '0');
      const payment = await this.repository.create({
        tenantId,
        loadId,
        transporterId: load.transporterId,
        paymentType: 'advance',
        amount,
        utrReference: input.utrReference.trim(),
        transactionId: input.transactionId?.trim() || null,
        proofFileKey: input.proofFileKey ?? null,
        paymentMode: input.paymentMode,
        account: input.account.trim(),
        paymentDate: input.paymentDate,
        recordedBy: actorId,
      });

      const updated = await this.loadRepository.update(tenantId, loadId, {
        advancePaidAt: new Date(),
        updatedBy: actorId,
      });
      if (input.proofFileKey && updated)
        await this.fileProof(tenantId, updated, actorId, input.proofFileKey);

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'PAYMENT_RECORDED',
        null,
        'advance',
        { amount, paymentMode: input.paymentMode },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_PAYMENT_RECORDED',
        resourceType: 'load_payment',
        newData: { id: payment.id, loadId, paymentType: 'advance', amount },
      });
      // The balance may already be in (Payment, stage 12) — the advance is the last thing owed.
      if (updated) await this.stageService.closeIfReady(tenantId, actorId, updated);
      return payment;
    } catch (error) {
      rethrow(error, 'Failed to record advance payment');
    }
  }

  /** Own transporter / indent, stage 11 → 12: the shipper records the payment once the
   *  transporter's invoice is in. "Amount under the same heads, less deduction; proof: UTR,
   *  payment advice, transaction ID or screenshot — proof is mandatory." The heads default to what
   *  is due (freight less the advance, plus each charge head); the amount is their sum less the
   *  deduction for an issue on the POD. The load closes once the advance is paid too. Due date is
   *  the E-POD date plus the transporter's credit days. A Loadsmart load pays Loadsmart's invoice
   *  instead. */
  async recordBalance(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: RecordBalanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType === 'own_fleet') {
        throw new ConflictError('Balance payment applies to market and indent loads only');
      }
      if (load.route === 'loadsmart') {
        return await this.recordLoadsmartPayment(load, actorId, input);
      }
      if (load.status !== 'invoice_generated' || !load.deliveredAt) {
        throw new ConflictError("Upload the transporter's invoice before recording the balance");
      }
      if (load.balancePaidAt) {
        throw new ConflictError('Balance has already been recorded for this load');
      }
      const proofError = paymentProofError(input);
      if (proofError) throw new ValidationError(proofError);
      if (input.proofFileKey) {
        await assertConfirmedUpload(
          this.storageService,
          tenantId,
          actorRole,
          input.proofFileKey,
          'loads/payment-proof',
        );
      }

      const summary = await this.summaryOf(load);
      const heads: PaymentHeads = input.heads ?? summary.balanceHeads;
      const deduction = summary.deduction;
      const amount = sumHeads(heads) - deduction;
      if (amount < 0) {
        throw new ValidationError('The deduction is more than the amount under the heads');
      }

      const transporter = load.transporterId
        ? await this.transporterService.getTransporter(tenantId, load.transporterId)
        : null;
      const dueDate = transporter
        ? toDateString(
            new Date(
              load.deliveredAt.getTime() + (transporter.creditDays ?? 1) * 24 * 60 * 60 * 1000,
            ),
          )
        : null;

      const payment = await this.repository.create({
        tenantId,
        loadId,
        transporterId: load.transporterId,
        paymentType: 'balance',
        amount: amount.toFixed(2),
        heads,
        deductionAmount: deduction ? deduction.toFixed(2) : null,
        utrReference: input.utrReference?.trim() || null,
        transactionId: input.transactionId?.trim() || null,
        proofFileKey: input.proofFileKey ?? null,
        paymentMode: input.paymentMode ?? null,
        account: input.account?.trim() || null,
        verificationStatus: null,
        paymentDate: input.paymentDate,
        dueDate,
        recordedBy: actorId,
      });

      const updated = await this.loadRepository.update(tenantId, loadId, {
        balancePaidAt: new Date(),
        updatedBy: actorId,
      });
      if (input.proofFileKey && updated)
        await this.fileProof(tenantId, updated, actorId, input.proofFileKey);

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'PAYMENT_RECORDED',
        null,
        'balance',
        { amount: payment.amount, heads, deduction, dueDate },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_PAYMENT_RECORDED',
        resourceType: 'load_payment',
        newData: {
          id: payment.id,
          loadId,
          paymentType: 'balance',
          amount: payment.amount,
          dueDate,
        },
      });

      if (updated) {
        const paid = await this.stageService.transition({
          tenantId,
          loadId,
          trigger: 'payment_recorded',
          actorId,
          load: updated,
          metadata: { paymentId: payment.id, amount: payment.amount },
        });
        await this.stageService.closeIfReady(tenantId, actorId, paid);
      }

      return payment;
    } catch (error) {
      rethrow(error, 'Failed to record balance payment');
    }
  }

  /** Where the load's money stands — freight, advance, approved charges by head, the deduction,
   *  and the balance due under each head. */
  async summary(tenantId: string, loadId: string) {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const [payments, charges] = await Promise.all([
        this.repository.listByLoad(tenantId, loadId),
        this.charges.listForLoad(tenantId, loadId),
      ]);
      return {
        loadId,
        route: load.route,
        ...moneySummary(load, payments, charges),
        payments,
        chargeItems: charges,
      };
    } catch (error) {
      rethrow(error, 'Failed to read the load money');
    }
  }

  private async summaryOf(load: LoadEntity) {
    const [payments, charges] = await Promise.all([
      this.repository.listByLoad(load.tenantId, load.id),
      this.charges.listForLoad(load.tenantId, load.id),
    ]);
    return moneySummary(load, payments, charges);
  }

  private async fileProof(tenantId: string, load: LoadEntity, actorId: string, fileKey: string) {
    await this.documents.save(
      tenantId,
      load,
      { updatedBy: actorId },
      { userId: actorId, source: 'web' },
      [{ docType: 'payment_proof', fileKey }],
    );
  }

  /** "No payment gateway yet": the shipper of a Loadsmart load pays the invoice by UPI QR or bank
   *  transfer and reports the UTR. The load moves to Payment; the payment stays pending until
   *  Loadsmart's Receivables matches it against the bank (a receipt), which is what settles the
   *  invoice. */
  private async recordLoadsmartPayment(
    load: LoadEntity,
    actorId: string,
    input: RecordBalanceInput,
  ): Promise<LoadPaymentEntity> {
    if (load.status !== 'invoice_generated' && load.status !== 'payment') {
      throw new ConflictError(
        "The balance is paid against Loadsmart's invoice, once it's generated",
      );
    }
    if (load.balancePaidAt) throw new ConflictError("Loadsmart's invoice is already settled");
    if (!input.utrReference?.trim()) {
      throw new ValidationError("Add the UTR of the payment to Loadsmart's invoice");
    }
    const amount = await this.loadsmartBilling?.balanceDueOf(load.tenantId, load.id);
    if (!amount) throw new ConflictError("Loadsmart's invoice for this load isn't generated yet");

    const payment = await this.repository.create({
      tenantId: load.tenantId,
      loadId: load.id,
      transporterId: null,
      paymentType: 'balance',
      amount,
      utrReference: input.utrReference!.trim(),
      paymentMode: input.paymentMode ?? null,
      account: input.account?.trim() || null,
      paymentDate: input.paymentDate,
      recordedBy: actorId,
      verificationStatus: 'pending',
      verifiedBy: null,
      verifiedAt: null,
    });
    if (load.status === 'invoice_generated') {
      await this.stageService.transition({
        tenantId: load.tenantId,
        loadId: load.id,
        trigger: 'payment_recorded',
        actorId,
        load,
        metadata: { paymentId: payment.id, amount },
      });
    }
    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      actorId,
      'PAYMENT_RECORDED',
      null,
      'balance',
      {
        amount,
        verification: 'pending',
      },
    );
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action: 'LOAD_PAYMENT_RECORDED',
      resourceType: 'load_payment',
      newData: { id: payment.id, loadId: load.id, paymentType: 'balance', amount },
    });
    return payment;
  }

  async listByLoad(tenantId: string, loadId: string): Promise<LoadPaymentEntity[]> {
    try {
      return await this.repository.listByLoad(tenantId, loadId);
    } catch (error) {
      rethrow(error, 'Failed to list load payments');
    }
  }
}
