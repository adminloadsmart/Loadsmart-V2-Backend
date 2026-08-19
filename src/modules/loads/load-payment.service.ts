import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { TransporterService } from '../masters/transporter.service';
import { toDateString } from '../../shared/utils/date';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadRepository } from './load.repository';
import { LoadActivityService } from './load-activity.service';
import { LoadEntity } from './entities/load.entity';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { RecordAdvanceInput, RecordBalanceInput } from './utils/load-payment.interface';

export function computeShareAmount(load: LoadEntity, percentage: string): string {
  const pct = Number(percentage) / 100;
  const freightValue = Number(load.freightValue ?? 0);
  const base =
    load.freightType === 'flat' ? freightValue : freightValue * Number(load.plannedCapacityTonnes);
  return (base * pct).toFixed(2);
}

export class LoadPaymentService {
  constructor(
    private readonly repository: LoadPaymentRepository,
    private readonly loadRepository: LoadRepository,
    private readonly transporterService: TransporterService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  /** Market loads only, and only once loading is confirmed. */
  async recordAdvance(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordAdvanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.sourceType !== 'market') {
        throw new ConflictError('Advance payment applies to market loads only');
      }
      if (!load.loadingConfirmedAt) {
        throw new ConflictError('Advance can only be recorded after loading is confirmed');
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
        proofFileKey: input.proofFileKey ?? null,
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
   *  transporter's credit terms. Recording balance closes the load once advance is also paid. */
  async recordBalance(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordBalanceInput,
  ): Promise<LoadPaymentEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.sourceType !== 'market') {
        throw new ConflictError('Balance payment applies to market loads only');
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
        proofFileKey: input.proofFileKey ?? null,
        paymentDate: input.paymentDate,
        dueDate,
        recordedBy: actorId,
      });

      await this.loadRepository.update(tenantId, loadId, {
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

      // Closed requires Delivered + (for market) both advance and balance paid.
      if (load.advancePaidAt) {
        const closed = await this.loadRepository.update(tenantId, loadId, {
          status: 'closed',
          closedAt: new Date(),
          updatedBy: actorId,
        });
        if (closed) {
          await this.loadActivityService.record(
            tenantId,
            loadId,
            actorId,
            'STATUS_CHANGED',
            'delivered',
            'closed',
          );
          await this.auditService.log({
            tenantId,
            userId: actorId,
            action: 'LOAD_CLOSED',
            resourceType: 'load',
            oldData: { id: loadId },
            newData: { id: loadId, status: 'closed' },
          });
        }
      }

      return payment;
    } catch (error) {
      rethrow(error, 'Failed to record balance payment');
    }
  }

  async listByLoad(tenantId: string, loadId: string): Promise<LoadPaymentEntity[]> {
    try {
      return await this.repository.listByLoad(tenantId, loadId);
    } catch (error) {
      rethrow(error, 'Failed to list load payments');
    }
  }
}
