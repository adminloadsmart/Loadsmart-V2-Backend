import { ConflictError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { LoadService } from '../loads/load.service';
import { LoadPaymentService } from '../loads/load-payment.service';
import { LoadActivityService } from '../loads/load-activity.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { TransporterSettlementRepository } from './transporter-settlement.repository';
import { TransporterSettlementEntity } from './entities/transporter-settlement.entity';
import { computeLoadPayableTotals } from './utils/load-payable-math';
import {
  RecordTransporterSettlementInput,
  TransporterSettlementSummary,
} from './utils/transporter-settlement.interface';

export class TransporterSettlementService {
  constructor(
    private readonly repository: TransporterSettlementRepository,
    private readonly loadService: LoadService,
    private readonly loadPaymentService: LoadPaymentService,
    private readonly transporterService: TransporterService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  /** Full freight value owed, minus whatever's already been recorded in load_payments
   *  (advance/balance) *and* any settlement already recorded here — the reconciliation
   *  FMS-BILL-R010 asks for. Once a settlement exists it accounts for the rest, by construction
   *  (recordSettlement always settles exactly whatever was remaining at the time), so folding its
   *  amount into totalPaid is what makes remainingAmount correctly read back as zero afterwards. */
  private async computeRemaining(tenantId: string, loadId: string) {
    const load = await this.loadService.assertExists(tenantId, loadId);
    if (load.sourceType !== 'market') {
      throw new ConflictError('Settlement applies to market loads only');
    }
    if (!load.transporterId) {
      throw new ConflictError('This load has no transporter to settle');
    }

    const transporter = await this.transporterService.getTransporter(tenantId, load.transporterId);
    const [payments, existingSettlement] = await Promise.all([
      this.loadPaymentService.listByLoad(tenantId, loadId),
      this.repository.findByLoadId(tenantId, loadId),
    ]);

    const totals = computeLoadPayableTotals(load, payments, existingSettlement);

    return { load, transporter, existingSettlement, ...totals };
  }

  async getSummary(tenantId: string, loadId: string): Promise<TransporterSettlementSummary> {
    try {
      const { load, transporter, existingSettlement, totalOwed, totalPaid, remainingAmount } =
        await this.computeRemaining(tenantId, loadId);

      return {
        loadId,
        transporterId: load.transporterId!,
        totalOwed,
        totalPaid,
        remainingAmount,
        bankDetailsOnFile: Boolean(transporter.bankAccountNumber && transporter.bankIfsc),
        alreadySettled: Boolean(existingSettlement),
      };
    } catch (error) {
      rethrow(error, 'Failed to compute transporter settlement summary');
    }
  }

  /** Records the payout for a completed load — refuses to run without the transporter's bank
   *  details on file (FMS-BILL-R011) or if there's nothing left owed. */
  async recordSettlement(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordTransporterSettlementInput,
  ): Promise<TransporterSettlementEntity> {
    try {
      const { load, transporter, existingSettlement, remainingAmount } =
        await this.computeRemaining(tenantId, loadId);

      if (!load.deliveredAt) {
        throw new ConflictError('Settlement can only be recorded once the load is delivered');
      }
      if (existingSettlement) {
        throw new ConflictError('Settlement has already been recorded for this load');
      }
      if (!transporter.bankAccountNumber || !transporter.bankIfsc) {
        throw new ValidationError(
          'Transporter bank details are required before a settlement payout can be recorded',
        );
      }
      if (Number(remainingAmount) <= 0) {
        throw new ConflictError('Nothing remaining to settle for this load');
      }

      const settlement = await this.repository.create({
        tenantId,
        loadId,
        transporterId: transporter.id,
        amount: remainingAmount,
        utrReference: input.utrReference.trim(),
        proofFileKey: input.proofFileKey ?? null,
        paymentDate: input.paymentDate,
        recordedBy: actorId,
      });

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'PAYMENT_RECORDED',
        null,
        'settlement',
        { amount: remainingAmount },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_SETTLEMENT_RECORDED',
        resourceType: 'transporter_settlement',
        newData: {
          id: settlement.id,
          loadId,
          transporterId: transporter.id,
          amount: remainingAmount,
        },
      });

      return settlement;
    } catch (error) {
      rethrow(error, 'Failed to record transporter settlement');
    }
  }
}
