import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { toDateString } from '../../shared/utils/date';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadRepository } from './load.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadStageService } from './load-stage.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import {
  RecordAdvanceInput,
  RecordBalanceInput,
  LoadsmartBilling,
} from './utils/load-payment.interface';

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
  ) {}

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  /** Market loads only, and only once the load is Loaded. */
  async recordAdvance(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordAdvanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.sourceType === 'own_fleet') {
        throw new ConflictError('Advance payment applies to market and indent loads only');
      }
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('Advance can only be recorded once the load is loaded');
      }
      if (load.advancePaidAt) {
        throw new ConflictError('Advance has already been recorded for this load');
      }

      const amount = computeShareAmount(load, load.advancePercentage ?? '0');
      const payment = await this.repository.create({
        tenantId,
        loadId,
        transporterId: load.transporterId,
        paymentType: 'advance',
        amount,
        utrReference: input.utrReference.trim(),
        paymentDate: input.paymentDate,
        recordedBy: actorId,
      });

      await this.loadRepository.update(tenantId, loadId, {
        advancePaidAt: new Date(),
        updatedBy: actorId,
      });

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'PAYMENT_RECORDED',
        null,
        'advance',
        {
          amount,
        },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_PAYMENT_RECORDED',
        resourceType: 'load_payment',
        newData: { id: payment.id, loadId, paymentType: 'advance', amount },
      });

      return payment;
    } catch (error) {
      rethrow(error, 'Failed to record advance payment');
    }
  }

  /** Market loads only, once E-POD is received; due date derives from the
   *  transporter's credit terms. Recording balance closes the load once advance is also paid,
   *  staff has accepted the E-POD and any delivery issue is settled (LoadStageService.closeIfReady)
   *  — whichever of those lands last closes it. */
  async recordBalance(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordBalanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.sourceType === 'own_fleet') {
        throw new ConflictError('Balance payment applies to market and indent loads only');
      }
      if (load.sourceType === 'loadsmart') {
        return await this.recordLoadsmartPayment(load, actorId, input);
      }
      if (!load.deliveredAt) {
        throw new ConflictError('Balance can only be recorded once the E-POD is received');
      }
      if (load.balancePaidAt) {
        throw new ConflictError('Balance has already been recorded for this load');
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

      const amount = computeShareAmount(load, load.balancePercentage ?? '0');
      const payment = await this.repository.create({
        tenantId,
        loadId,
        transporterId: load.transporterId,
        paymentType: 'balance',
        amount,
        utrReference: input.utrReference.trim(),
        verificationStatus: null,
        paymentDate: input.paymentDate,
        dueDate,
        recordedBy: actorId,
      });

      const updated = await this.loadRepository.update(tenantId, loadId, {
        balancePaidAt: new Date(),
        updatedBy: actorId,
      });

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'PAYMENT_RECORDED',
        null,
        'balance',
        {
          amount,
          dueDate,
        },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_PAYMENT_RECORDED',
        resourceType: 'load_payment',
        newData: { id: payment.id, loadId, paymentType: 'balance', amount, dueDate },
      });

      // Closed requires Delivered without issues + E-POD accepted + both advance and balance paid.
      if (updated) await this.stageService.closeIfReady(tenantId, actorId, updated);

      return payment;
    } catch (error) {
      rethrow(error, 'Failed to record balance payment');
    }
  }

  /** "No payment gateway yet": the shipper of a Loadsmart load pays the invoice's balance by UPI
   *  QR or bank transfer and records the UTR. It counts as verified at once — the load moves to
   *  Payment and closes once Loadsmart has paid the partner's balance too. */
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
    if (load.balancePaidAt) throw new ConflictError('The balance is already paid');
    const amount = await this.loadsmartBilling?.balanceDueOf(load.tenantId, load.id);
    if (!amount) throw new ConflictError("Loadsmart's invoice for this load isn't generated yet");

    const now = new Date();
    const payment = await this.repository.create({
      tenantId: load.tenantId,
      loadId: load.id,
      transporterId: null,
      paymentType: 'balance',
      amount,
      utrReference: input.utrReference.trim(),
      paymentDate: input.paymentDate,
      recordedBy: actorId,
      verificationStatus: 'verified',
      verifiedBy: actorId,
      verifiedAt: now,
    });
    let updated = await this.loadRepository.update(load.tenantId, load.id, {
      balancePaidAt: now,
      updatedBy: actorId,
    });
    if (updated?.status === 'invoice_generated') {
      updated = await this.stageService.transition({
        tenantId: load.tenantId,
        loadId: load.id,
        to: 'payment',
        actorId,
        load: updated,
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
        verification: 'verified',
      },
    );
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action: 'LOAD_PAYMENT_RECORDED',
      resourceType: 'load_payment',
      newData: { id: payment.id, loadId: load.id, paymentType: 'balance', amount },
    });
    if (updated) await this.stageService.closeIfReady(load.tenantId, actorId, updated);
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
