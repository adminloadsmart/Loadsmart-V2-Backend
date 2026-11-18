import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  RECEIPT_CHANNELS,
  ReceiptChannel,
  SHORTFALL_REASONS,
  ShortfallReason,
} from '../loadsmart.types';

/** Money received against a Loadsmart invoice (R03), matched by hand against the bank
 *  statement. A receipt can verify the payment the shipper reported in the app, or come from an
 *  unclaimed payment matched to the invoice. */
@Entity({ schema: 'loads', name: 'ls_receipts' })
@Index('ls_receipts_invoice_idx', ['invoiceId'])
export class LsReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'received_on', type: 'date' })
  receivedOn!: string;

  @Column({ name: 'paid_through', type: 'enum', enum: [...RECEIPT_CHANNELS] })
  paidThrough!: ReceiptChannel;

  @Column({ name: 'utr_reference', type: 'varchar', length: 100, nullable: true })
  utrReference!: string | null;

  /** TDS the shipper cut — explains that much of a gap. */
  @Column({ name: 'tds_cut', type: 'numeric', precision: 14, scale: 2, default: 0 })
  tdsCut!: string;

  @Column({ name: 'shortfall_reason', type: 'enum', enum: [...SHORTFALL_REASONS], nullable: true })
  shortfallReason!: ShortfallReason | null;

  @Column({ name: 'shortfall_note', type: 'varchar', length: 500, nullable: true })
  shortfallNote!: string | null;

  /** The payment advice (PDF or screenshot), filed on the load as `payment_proof`. */
  @Column({ name: 'proof_file_key', type: 'text', nullable: true })
  proofFileKey!: string | null;

  /** The shipper's reported payment (loads.load_payments) this receipt verifies. */
  @Column({ name: 'load_payment_id', type: 'uuid', nullable: true })
  loadPaymentId!: string | null;

  @Column({ name: 'unclaimed_payment_id', type: 'uuid', nullable: true })
  unclaimedPaymentId!: string | null;

  @Column({ name: 'recorded_by', type: 'uuid' })
  recordedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
