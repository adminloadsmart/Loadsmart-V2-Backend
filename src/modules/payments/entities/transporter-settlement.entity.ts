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
import { LoadEntity } from '../../loads/entities/load.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';

/**
 * The final payout record for a market load's transporter — reconciles the full freight value
 * against whatever was already recorded in loads.load_payments (advance/balance) and captures
 * proof of the remaining payout. Distinct from load_payments (see its doc comment): that table is
 * per-load advance/balance UTR capture as part of the trip lifecycle; this is the Billing
 * module's settlement record. One settlement per load (MVP1 — no multi-load batched payouts yet).
 */
@Entity({ schema: 'payments', name: 'transporter_settlements' })
@Index('transporter_settlements_tenant_transporter_idx', ['tenantId', 'transporterId'])
@Index('transporter_settlements_load_unique', ['loadId'], { unique: true })
export class TransporterSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ name: 'transporter_id', type: 'uuid' })
  transporterId!: string;

  @ManyToOne(() => TransporterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ name: 'utr_reference', type: 'varchar', length: 100 })
  utrReference!: string;

  /** Optional screenshot of the payment proof — storage `key`, same convention as
   *  LoadPaymentEntity's proofFileKey. */
  @Column({ name: 'proof_file_key', type: 'text', nullable: true })
  proofFileKey!: string | null;

  @Column({ name: 'payment_date', type: 'date' })
  paymentDate!: string;

  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
