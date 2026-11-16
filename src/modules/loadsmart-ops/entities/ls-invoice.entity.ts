import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { GstSplit, InvoiceLine } from '../billing-rules';
import {
  INVOICE_SEND_CHANNELS,
  INVOICE_STATUSES,
  InvoiceSendChannel,
  InvoiceStatus,
} from '../loadsmart.types';

/** Loadsmart's invoice to the shipper for one load (R02) — drafted from the load by the system,
 *  issued by Receivables on the POD image (or the original, for shippers who need it). Amounts per
 *  billing-rules.ts's buildInvoiceDraft. The due date is set once the shipper has received it. */
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

  /** Null until the shipper has received it. */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'enum', enum: [...INVOICE_STATUSES], default: 'issued' })
  status!: InvoiceStatus;

  /** The drafted lines, billing instructions applied (left-off charges are marked). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines!: InvoiceLine[];

  /** Reverse charge, place of supply, CGST + SGST or IGST. */
  @Column({ name: 'gst_split', type: 'jsonb', nullable: true })
  gstSplit!: GstSplit | null;

  @Column({ name: 'credit_days', type: 'integer', nullable: true })
  creditDays!: number | null;

  @Column({ name: 'sent_via', type: 'enum', enum: [...INVOICE_SEND_CHANNELS], nullable: true })
  sentVia!: InvoiceSendChannel | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  /** The shipper's receipt date — sets the due date. */
  @Column({ name: 'received_on', type: 'date', nullable: true })
  receivedOn!: string | null;

  /** What is still short after receipts, TDS and credit notes (negative: excess). */
  @Column({ name: 'open_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  openAmount!: string | null;

  /** An unexplained gap — Receivables follows it up. */
  @Column({ name: 'follow_up', type: 'boolean', default: false })
  followUp!: boolean;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @Column({ name: 'file_key', type: 'text', nullable: true })
  fileKey!: string | null;

  @Column({ name: 'issued_by', type: 'uuid', nullable: true })
  issuedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
