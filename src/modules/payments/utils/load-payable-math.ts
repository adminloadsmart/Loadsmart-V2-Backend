import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { computeShareAmount } from '../../loads/load-payment.service';
import { TransporterSettlementEntity } from '../entities/transporter-settlement.entity';

export interface LoadPayableTotals {
  totalOwed: string;
  totalPaid: string;
  remainingAmount: string;
}

/**
 * Full freight value owed for a market load, minus whatever's already been recorded in
 * loads.load_payments (advance/balance) and any transporter settlement recorded for it. Shared
 * by transporter-settlement.service.ts and transporter-payables.service.ts so both features stay
 * consistent — a load settled here stops showing a pending/overdue balance there too.
 *
 * Since advancePercentage + balancePercentage always sum to 100 (dispatch-planning.service.ts
 * enforces balancePercentage = 100 - advancePercentage), remainingAmount is mathematically the
 * same thing as "balance pending" once advance is paid — no separate share-percentage calc needed
 * for that column on the payables dashboard.
 */
export function computeLoadPayableTotals(
  load: LoadEntity,
  payments: LoadPaymentEntity[],
  settlement: TransporterSettlementEntity | null,
): LoadPayableTotals {
  const totalOwed = computeShareAmount(load, '100');
  const paymentsTotal = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const settlementTotal = settlement ? Number(settlement.amount) : 0;
  const totalPaid = paymentsTotal + settlementTotal;
  const remainingAmount = (Number(totalOwed) - totalPaid).toFixed(2);

  return { totalOwed, totalPaid: totalPaid.toFixed(2), remainingAmount };
}
