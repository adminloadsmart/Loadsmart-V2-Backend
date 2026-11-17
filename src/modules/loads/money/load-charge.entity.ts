import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  CHARGE_HEADS,
  CHARGE_RAISERS,
  CHARGE_STATUSES,
  ChargeHead,
  ChargeRaiser,
  ChargeStatus,
} from './charge.types';

/** A charge on a load, under one of the heads (charge.types.ts).
 *  - Own transporter / indent: the shipper adds it with its proof (a photo or document), approved
 *    as entered; it is paid to the transporter with the balance.
 *  - Loadsmart: Loadsmart's team raises it and the shipper approves it; the shipper can also enter
 *    the unloading amount agreed with the receiver. An approved charge goes on the shipper's
 *    invoice and on the partner's balance. */
@Entity({ schema: 'loads', name: 'load_charges' })
@Index('load_charges_tenant_load_idx', ['tenantId', 'loadId'])
export class LoadChargeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'charge_type', type: 'enum', enum: [...CHARGE_HEADS] })
  chargeType!: ChargeHead;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  /** The remark — required with the `other` head. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  /** The photo or document that proves it (required on own-transporter and indent loads). */
  @Column({ name: 'proof_file_key', type: 'text', nullable: true })
  proofFileKey!: string | null;

  @Column({ type: 'enum', enum: [...CHARGE_STATUSES], default: 'raised' })
  status!: ChargeStatus;

  @Column({ name: 'raised_by_party', type: 'enum', enum: [...CHARGE_RAISERS] })
  raisedByParty!: ChargeRaiser;

  @Column({ name: 'raised_by', type: 'uuid', nullable: true })
  raisedBy!: string | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  /** Loadsmart loads: approved as raised because the shipper pre-approved this head. */
  @Column({ type: 'boolean', default: false })
  preapproved!: boolean;

  /** The shipper's question, and Loadsmart's answer. */
  @Column({ name: 'query_reason', type: 'varchar', length: 500, nullable: true })
  queryReason!: string | null;

  @Column({ name: 'queried_at', type: 'timestamptz', nullable: true })
  queriedAt!: Date | null;

  @Column({ name: 'query_reply', type: 'varchar', length: 1000, nullable: true })
  queryReply!: string | null;

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
