import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoadPaymentEntity } from './entities/load-payment.entity';
import { LoadPaymentType } from './utils/loads.types';

export interface CreateLoadPaymentData {
  tenantId: string;
  loadId: string;
  transporterId: string | null;
  paymentType: LoadPaymentType;
  amount: string;
  utrReference: string;
  proofFileKey?: string | null;
  paymentDate: string;
  dueDate?: string | null;
  recordedBy: string | null;
}

export class LoadPaymentRepository {
  private readonly payments: Repository<LoadPaymentEntity>;

  constructor(dataSource: DataSource) {
    this.payments = dataSource.getRepository(LoadPaymentEntity);
  }

  create(data: CreateLoadPaymentData, manager?: EntityManager): Promise<LoadPaymentEntity> {
    const repo = manager?.getRepository(LoadPaymentEntity) ?? this.payments;
    const payment = repo.create({
      ...data,
      proofFileKey: data.proofFileKey ?? null,
      dueDate: data.dueDate ?? null,
    });
    return repo.save(payment);
  }

  findByLoadAndType(
    tenantId: string,
    loadId: string,
    paymentType: LoadPaymentType,
  ): Promise<LoadPaymentEntity | null> {
    return this.payments.findOneBy({ tenantId, loadId, paymentType });
  }

  listByLoad(tenantId: string, loadId: string): Promise<LoadPaymentEntity[]> {
    return this.payments.find({ where: { tenantId, loadId }, order: { createdAt: 'ASC' } });
  }

  /** Keeps a future transporter-payables view queryable by transporterId without a join
   *  through loads — see LoadPaymentEntity's doc comment on the denormalized transporterId. */
  async listByTransporter(
    tenantId: string,
    transporterId: string,
    filters: { page: number; limit: number },
  ): Promise<[LoadPaymentEntity[], number]> {
    return this.payments.findAndCount({
      where: { tenantId, transporterId },
      order: { createdAt: 'DESC' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    });
  }
}
