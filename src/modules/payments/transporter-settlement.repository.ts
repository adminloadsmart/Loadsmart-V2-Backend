import { DataSource, EntityManager, Repository } from 'typeorm';
import { TransporterSettlementEntity } from './entities/transporter-settlement.entity';

export interface CreateTransporterSettlementData {
  tenantId: string;
  loadId: string;
  transporterId: string;
  amount: string;
  utrReference: string;
  proofFileKey?: string | null;
  paymentDate: string;
  recordedBy: string | null;
}

export class TransporterSettlementRepository {
  private readonly settlements: Repository<TransporterSettlementEntity>;

  constructor(dataSource: DataSource) {
    this.settlements = dataSource.getRepository(TransporterSettlementEntity);
  }

  create(
    data: CreateTransporterSettlementData,
    manager?: EntityManager,
  ): Promise<TransporterSettlementEntity> {
    const repo = manager?.getRepository(TransporterSettlementEntity) ?? this.settlements;
    const settlement = repo.create({ ...data, proofFileKey: data.proofFileKey ?? null });
    return repo.save(settlement);
  }

  findByLoadId(tenantId: string, loadId: string): Promise<TransporterSettlementEntity | null> {
    return this.settlements.findOneBy({ tenantId, loadId });
  }
}
