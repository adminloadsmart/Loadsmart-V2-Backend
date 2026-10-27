import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Loadsmart's invoice to the shipper for one load, raised by Receivables once the original POD
 *  is in. Amounts per loadsmart-rules.ts's invoiceAmounts. */
@Entity({ schema: 'loads', name: 'ls_invoices' })
export class LsInvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid', unique: true })
  loadId!: string;

  @Column({ name: 'invoice_number', type: 'varchar', length: 30, unique: true })
  invoiceNumber!: string;

  @Column({ name: 'freight_amount', type: 'numeric', precision: 14, scale: 2 })
  freightAmount!: string;

  @Column({ name: 'charges_amount', type: 'numeric', precision: 14, scale: 2 })
  chargesAmount!: string;

  @Column({ name: 'claim_credit', type: 'numeric', precision: 14, scale: 2 })
  claimCredit!: string;

  @Column({ name: 'taxable_amount', type: 'numeric', precision: 14, scale: 2 })
  taxableAmount!: string;

  @Column({ name: 'gst_percent', type: 'numeric', precision: 5, scale: 2 })
  gstPercent!: string;

  @Column({ name: 'gst_amount', type: 'numeric', precision: 14, scale: 2 })
  gstAmount!: string;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2 })
  totalAmount!: string;

  @Column({ name: 'advance_received', type: 'numeric', precision: 14, scale: 2 })
  advanceReceived!: string;

  @Column({ name: 'balance_due', type: 'numeric', precision: 14, scale: 2 })
  balanceDue!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey!: string | null;

  @Column({ name: 'issued_by', type: 'uuid', nullable: true })
  issuedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
