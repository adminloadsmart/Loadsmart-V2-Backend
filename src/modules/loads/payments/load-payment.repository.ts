import { DataSource, EntityManager, Repository } from 'typeorm';
import { LoadPaymentEntity } from '../entities/load-payment.entity';
import { LoadPaymentType } from '../utils/loads.types';
import { PaymentHeads, PaymentMode } from '../money/money-rules';

export interface CreateLoadPaymentData {
  tenantId: string;
  loadId: string;
  transporterId: string | null;
  paymentType: LoadPaymentType;
  amount: string;
  utrReference: string | null;
  transactionId?: string | null;
  proofFileKey?: string | null;
  paymentMode?: PaymentMode | null;
  account?: string | null;
  heads?: PaymentHeads | null;
  deductionAmount?: string | null;
  /** `pending`: a Loadsmart shipper's reported payment, until Receivables matches it. */
  verificationStatus?: 'pending' | 'verified' | null;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
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

  findById(tenantId: string, loadId: string, id: string): Promise<LoadPaymentEntity | null> {
    return this.payments.findOneBy({ tenantId, loadId, id });
  }

  /** The shipper sends a payment again after Receivables rejected the first — a load holds one
   *  balance payment (a unique row per load and type), so the rejected one is reused, back to
   *  pending with the new UTR and proof. */
  async resubmit(
    tenantId: string,
    id: string,
    fields: {
      utrReference: string | null;
      proofFileKey: string | null;
      paymentMode: PaymentMode | null;
      account: string | null;
      paymentDate: string;
      recordedBy: string | null;
    },
  ): Promise<LoadPaymentEntity | null> {
    const result = await this.payments.update(
      { tenantId, id, verificationStatus: 'rejected' },
      {
        ...fields,
        verificationStatus: 'pending',
        verifiedBy: null,
        verifiedAt: null,
        rejectionReason: null,
      },
    );
    return result.affected ? this.payments.findOneBy({ tenantId, id }) : null;
  }

  /** Loadsmart's Receivables matched the shipper's reported payment against the bank. */
  async markVerified(
    tenantId: string,
    id: string,
    verifiedBy: string,
    verifiedAt: Date,
  ): Promise<boolean> {
    const result = await this.payments.update(
      { tenantId, id, verificationStatus: 'pending' },
      { verificationStatus: 'verified', verifiedBy, verifiedAt },
    );
    return !!result.affected;
  }

  /** Verifies a payment the shipper recorded that nobody has checked yet (no status, or pending)
   *  — Receivables confirming a shipper's advance on a Loadsmart load. */
  async markReportedVerified(
    tenantId: string,
    id: string,
    verifiedBy: string,
    verifiedAt: Date,
  ): Promise<boolean> {
    const result = await this.payments
      .createQueryBuilder()
      .update()
      .set({ verificationStatus: 'verified', verifiedBy, verifiedAt })
      .where('tenant_id = :tenantId AND id = :id', { tenantId, id })
      .andWhere("(verification_status IS NULL OR verification_status = 'pending')")
      .execute();
    return !!result.affected;
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
