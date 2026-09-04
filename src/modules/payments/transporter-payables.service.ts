import { toDateString } from '../../shared/utils/date';
import { rethrow } from '../../shared/errors';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentEntity } from '../loads/entities/load-payment.entity';
import { TransporterEntity } from '../masters/transporter/entities/transporter.entity';
import { TransporterSettlementEntity } from './entities/transporter-settlement.entity';
import { TransporterPayablesRepository } from './transporter-payables.repository';
import { computeLoadPayableTotals } from './utils/load-payable-math';
import {
  TransporterLoadsQuery,
  TransporterLoadsResult,
  TransporterPayableLoadRow,
  TransporterPayableRow,
  TransporterPayablesDashboard,
  TransporterPayablesQuery,
  TransporterPayablesTiles,
} from './utils/transporter-payables.interface';

interface LoadPayableRow {
  load: LoadEntity;
  transporter: TransporterEntity;
  advancePaid: string;
  totalPaid: string;
  balancePending: string;
  dueDate: string | null;
  overdueAmount: string;
  isOverdue: boolean;
  podPending: boolean;
  paidInPeriod: number;
}

export class TransporterPayablesService {
  constructor(private readonly repository: TransporterPayablesRepository) {}

  /** Loads a set of market loads plus their recorded payments/settlements and reduces each one
   *  into the money/date figures every view here is built from. */
  private async buildRows(
    tenantId: string,
    loads: LoadEntity[],
    dateRange: { from?: string; to?: string },
  ): Promise<LoadPayableRow[]> {
    const loadIds = loads.map((load) => load.id);
    const [payments, settlements] = await Promise.all([
      this.repository.listPaymentsByLoadIds(tenantId, loadIds),
      this.repository.listSettlementsByLoadIds(tenantId, loadIds),
    ]);

    const paymentsByLoad = new Map<string, LoadPaymentEntity[]>();
    for (const payment of payments) {
      const list = paymentsByLoad.get(payment.loadId) ?? [];
      list.push(payment);
      paymentsByLoad.set(payment.loadId, list);
    }
    const settlementByLoad = new Map<string, TransporterSettlementEntity>();
    for (const settlement of settlements) settlementByLoad.set(settlement.loadId, settlement);

    const today = toDateString(new Date());
    const inPeriod = (dateStr: string) =>
      (!dateRange.from || dateStr >= dateRange.from) && (!dateRange.to || dateStr <= dateRange.to);

    return loads.map((load): LoadPayableRow => {
      const loadPayments = paymentsByLoad.get(load.id) ?? [];
      const settlement = settlementByLoad.get(load.id) ?? null;
      const { totalPaid, remainingAmount } = computeLoadPayableTotals(
        load,
        loadPayments,
        settlement,
      );

      const advancePayment = loadPayments.find((payment) => payment.paymentType === 'advance');
      // Advance/balance credit days live on the transporter master; a load carries its own
      // relation via the `transporter: true` join in the repository.
      const creditDays = load.transporter?.creditDays ?? 1;
      const dueDate = load.deliveredAt
        ? toDateString(new Date(load.deliveredAt.getTime() + creditDays * 24 * 60 * 60 * 1000))
        : null;
      const remaining = Number(remainingAmount);
      const isOverdue = remaining > 0 && dueDate !== null && dueDate < today;

      let paidInPeriod = 0;
      for (const payment of loadPayments) {
        if (inPeriod(payment.paymentDate)) paidInPeriod += Number(payment.amount);
      }
      if (settlement && inPeriod(settlement.paymentDate)) paidInPeriod += Number(settlement.amount);

      return {
        load,
        // Non-null: the repository's listMarketLoads always filters transporterId IS NOT NULL
        // and joins the relation, so every load here has one.
        transporter: load.transporter!,
        advancePaid: advancePayment?.amount ?? '0.00',
        totalPaid,
        balancePending: remainingAmount,
        dueDate,
        overdueAmount: isOverdue ? remainingAmount : '0.00',
        isOverdue,
        podPending: !load.deliveredAt,
        paidInPeriod,
      };
    });
  }

  async getDashboard(
    tenantId: string,
    input: TransporterPayablesQuery,
  ): Promise<TransporterPayablesDashboard> {
    try {
      const loads = await this.repository.listMarketLoads(tenantId, {
        transporterId: input.transporterId,
      });
      const rows = await this.buildRows(tenantId, loads, { from: input.from, to: input.to });

      const tiles: TransporterPayablesTiles = rows.reduce(
        (acc, row) => {
          const remaining = Number(row.balancePending);
          if (remaining > 0) {
            acc.totalPending = (Number(acc.totalPending) + remaining).toFixed(2);
            if (row.isOverdue) acc.overdue = (Number(acc.overdue) + remaining).toFixed(2);
            else acc.due = (Number(acc.due) + remaining).toFixed(2);
          }
          acc.paidInPeriod = (Number(acc.paidInPeriod) + row.paidInPeriod).toFixed(2);
          return acc;
        },
        { totalPending: '0.00', due: '0.00', overdue: '0.00', paidInPeriod: '0.00' },
      );

      const byTransporter = new Map<string, LoadPayableRow[]>();
      for (const row of rows) {
        const list = byTransporter.get(row.transporter.id) ?? [];
        list.push(row);
        byTransporter.set(row.transporter.id, list);
      }

      const matchesRowFilter = (row: LoadPayableRow) =>
        (input.overdueOnly === undefined || row.isOverdue === input.overdueOnly) &&
        (input.podPending === undefined || row.podPending === input.podPending);

      let transporterRows: TransporterPayableRow[] = [];
      for (const [transporterId, transporterLoadRows] of byTransporter) {
        if (!transporterLoadRows.some(matchesRowFilter)) continue;

        const transporter = transporterLoadRows[0].transporter;
        transporterRows.push({
          transporterId,
          transporterName: transporter.name,
          advancePercentage: transporter.advancePercentage
            ? Number(transporter.advancePercentage)
            : null,
          creditDays: transporter.creditDays,
          loadsCount: transporterLoadRows.length,
          podPendingCount: transporterLoadRows.filter((row) => row.podPending).length,
          advancePaid: transporterLoadRows
            .reduce((sum, row) => sum + Number(row.advancePaid), 0)
            .toFixed(2),
          balancePending: transporterLoadRows
            .reduce((sum, row) => sum + Math.max(Number(row.balancePending), 0), 0)
            .toFixed(2),
          dueAmount: transporterLoadRows
            .reduce(
              (sum, row) => sum + (row.isOverdue ? 0 : Math.max(Number(row.balancePending), 0)),
              0,
            )
            .toFixed(2),
          overdueAmount: transporterLoadRows
            .reduce((sum, row) => sum + Number(row.overdueAmount), 0)
            .toFixed(2),
          paidToDate: transporterLoadRows
            .reduce((sum, row) => sum + Number(row.totalPaid), 0)
            .toFixed(2),
        });
      }

      transporterRows.sort((a, b) => Number(b.overdueAmount) - Number(a.overdueAmount));
      const total = transporterRows.length;
      const start = (input.page - 1) * input.limit;
      transporterRows = transporterRows.slice(start, start + input.limit);

      return { tiles, transporters: transporterRows, total };
    } catch (error) {
      rethrow(error, 'Failed to compute transporter payables dashboard');
    }
  }

  async getTransporterLoads(
    tenantId: string,
    transporterId: string,
    input: TransporterLoadsQuery,
  ): Promise<TransporterLoadsResult> {
    try {
      const loads = await this.repository.listMarketLoads(tenantId, { transporterId });
      const rows = await this.buildRows(tenantId, loads, {});

      let items: TransporterPayableLoadRow[] = rows
        .filter(
          (row) =>
            (input.overdueOnly === undefined || row.isOverdue === input.overdueOnly) &&
            (input.podPending === undefined || row.podPending === input.podPending),
        )
        .map((row) => ({
          loadId: row.load.id,
          loadCode: row.load.code,
          podStatus: (row.podPending ? 'pending' : 'uploaded') as 'pending' | 'uploaded',
          deliveredAt: row.load.deliveredAt ? toDateString(row.load.deliveredAt) : null,
          advancePaid: row.advancePaid,
          balancePending: row.balancePending,
          dueDate: row.dueDate,
          overdueAmount: row.overdueAmount,
          isOverdue: row.isOverdue,
        }))
        .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'));

      const total = items.length;
      const start = (input.page - 1) * input.limit;
      items = items.slice(start, start + input.limit);

      return { items, total };
    } catch (error) {
      rethrow(error, 'Failed to list transporter payable loads');
    }
  }
}
