import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PARTNER_PAYMENT_TYPES, PartnerPaymentType } from '../loadsmart.types';

/** Money Loadsmart pays its partner on a load — the trucker advance once Loaded, the balance once
 *  the original POD is in. Kept apart from loads.load_payments, which is the shipper's side. */
@Entity({ schema: 'loads', name: 'ls_partner_payments' })
@Index('ls_partner_payments_sourcing_type_idx', ['sourcingId', 'paymentType'], { unique: true })
export class LsPartnerPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId!: string;

  @Column({ name: 'payment_type', type: 'enum', enum: [...PARTNER_PAYMENT_TYPES] })
  paymentType!: PartnerPaymentType;

  @Column({ name: 'gross_amount', type: 'numeric', precision: 12, scale: 2 })
  grossAmount!: string;

  @Column({ name: 'tds_amount', type: 'numeric', precision: 12, scale: 2 })
  tdsAmount!: string;

  /** Claims recovered from the partner (balance only). */
  @Column({ name: 'deduction_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  deductionAmount!: string;

  @Column({ name: 'net_amount', type: 'numeric', precision: 12, scale: 2 })
  netAmount!: string;

  @Column({ name: 'utr_reference', type: 'varchar', length: 100 })
  utrReference!: string;

  @Column({ name: 'paid_by', type: 'uuid', nullable: true })
  paidBy!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
