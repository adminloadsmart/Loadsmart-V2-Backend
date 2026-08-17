import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LoadEntity } from './load.entity';
import { TransporterEntity } from '../../masters/entities/transporter.entity';
import { LOAD_PAYMENT_TYPES, LoadPaymentType } from '../utils/loads.types';

/**
 * A recorded advance/balance payment against a market load — basic UTR/proof
 * capture only; GST invoicing, credit notes, aging reports and settlement runs are the separate,
 * MVP-gated Billing module, not this table. One row per (loadId, paymentType) — a load
 * has at most one advance and one balance payment.
 */
@Entity({ schema: 'loads', name: 'load_payments' })
@Index('load_payments_tenant_load_idx', ['tenantId', 'loadId'])
@Index('load_payments_tenant_transporter_idx', ['tenantId', 'transporterId'])
@Index('load_payments_load_type_unique', ['loadId', 'paymentType'], { unique: true })
export class LoadPaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  /** Denormalized snapshot of the load's transporter at payment time — keeps a future
   *  transporter-payables view queryable by transporterId without a join through loads. */
  @Column({ name: 'transporter_id', type: 'uuid', nullable: true })
  transporterId!: string | null;

  @ManyToOne(() => TransporterEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity | null;

  @Column({ name: 'payment_type', type: 'enum', enum: [...LOAD_PAYMENT_TYPES] })
  paymentType!: LoadPaymentType;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ name: 'utr_reference', type: 'varchar', length: 100 })
  utrReference!: string;

  /** Optional screenshot of the payment proof — storage `key`, same convention as LoadEntity's
   *  document columns. */
  @Column({ name: 'proof_file_key', type: 'text', nullable: true })
  proofFileKey!: string | null;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate!: string;

  /** Balance only — E-POD date + transporter.creditDays. */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
