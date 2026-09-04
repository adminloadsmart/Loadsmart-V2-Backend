import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentEntity } from '../loads/entities/load-payment.entity';
import { TransporterSettlementEntity } from './entities/transporter-settlement.entity';

export class TransporterPayablesRepository {
  private readonly loads: Repository<LoadEntity>;
  private readonly payments: Repository<LoadPaymentEntity>;
  private readonly settlements: Repository<TransporterSettlementEntity>;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.payments = dataSource.getRepository(LoadPaymentEntity);
    this.settlements = dataSource.getRepository(TransporterSettlementEntity);
  }

  /** Every market load with a transporter assigned — the payable universe. `podPending` narrows
   *  to loads awaiting E-POD; every other filter (overdue, date range) is computed in JS since it
   *  depends on the transporter's credit days and recorded payments, not a single column. */
  listMarketLoads(
    tenantId: string,
    filters: { transporterId?: string; podPending?: boolean },
  ): Promise<LoadEntity[]> {
    return this.loads.find({
      where: {
        tenantId,
        sourceType: 'market',
        transporterId: filters.transporterId ?? Not(IsNull()),
        ...(filters.podPending !== undefined
          ? { deliveredAt: filters.podPending ? IsNull() : Not(IsNull()) }
          : {}),
      },
      relations: { transporter: true },
    });
  }

  listPaymentsByLoadIds(tenantId: string, loadIds: string[]): Promise<LoadPaymentEntity[]> {
    if (loadIds.length === 0) return Promise.resolve([]);
    return this.payments.find({ where: { tenantId, loadId: In(loadIds) } });
  }

  listSettlementsByLoadIds(
    tenantId: string,
    loadIds: string[],
  ): Promise<TransporterSettlementEntity[]> {
    if (loadIds.length === 0) return Promise.resolve([]);
    return this.settlements.find({ where: { tenantId, loadId: In(loadIds) } });
  }
}
