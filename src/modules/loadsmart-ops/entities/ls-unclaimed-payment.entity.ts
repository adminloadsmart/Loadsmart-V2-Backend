import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  PAYMENT_MODES_IN,
  PaymentModeIn,
  UNCLAIMED_STATUSES,
  UnclaimedStatus,
} from '../loadsmart.types';

export interface UnclaimedRemark {
  at: string;
  by: string;
  text: string;
}

/** Money in Loadsmart's bank that matches no customer or invoice. Receivables works it until it
 *  is matched to an invoice (a receipt is recorded) or refunded to the payer. Nothing is sent to
 *  salespeople from here. */
@Entity({ schema: 'loads', name: 'ls_unclaimed_payments' })
@Index('ls_unclaimed_payments_status_idx', ['status'])
export class LsUnclaimedPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'payer_name', type: 'varchar', length: 150 })
  payerName!: string;

  @Column({ type: 'enum', enum: [...PAYMENT_MODES_IN] })
  mode!: PaymentModeIn;

  @Column({ name: 'utr_reference', type: 'varchar', length: 100, nullable: true })
  utrReference!: string | null;

  @Column({ name: 'remitter_bank', type: 'varchar', length: 150, nullable: true })
  remitterBank!: string | null;

  @Column({ name: 'received_on', type: 'date' })
  receivedOn!: string;

  @Column({ type: 'enum', enum: [...UNCLAIMED_STATUSES], default: 'unclaimed' })
  status!: UnclaimedStatus;

  @Column({ name: 'matched_invoice_id', type: 'uuid', nullable: true })
  matchedInvoiceId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  remarks!: UnclaimedRemark[];

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
