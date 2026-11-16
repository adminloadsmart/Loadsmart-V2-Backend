import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ORIGINAL_POD_STATUSES, OriginalPodStatus } from '../loadsmart.types';

export interface OriginalPodCall {
  at: string;
  by: string;
  outcome: string;
  note: string | null;
}

/** The original POD tracker (Y03): every delivered Loadsmart load until its signed paper POD is
 *  filed at the Mohali office. It releases the carrier's balance; after the due days a penalty a
 *  day comes off that balance (worked out from the settings the load was posted under, and
 *  frozen once it is received). */
@Entity({ schema: 'loads', name: 'ls_original_pods' })
@Index('ls_original_pods_status_idx', ['status'])
export class LsOriginalPodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid', unique: true })
  loadId!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ type: 'enum', enum: [...ORIGINAL_POD_STATUSES], default: 'yet_to_dispatch' })
  status!: OriginalPodStatus;

  /** The IST date the load was delivered — the 15 days count from here. */
  @Column({ name: 'delivered_on', type: 'date' })
  deliveredOn!: string;

  @Column({ name: 'courier_name', type: 'varchar', length: 100, nullable: true })
  courierName!: string | null;

  @Column({ name: 'docket_number', type: 'varchar', length: 100, nullable: true })
  docketNumber!: string | null;

  /** Who has it now (driver, broker, courier…). */
  @Column({ type: 'varchar', length: 150, nullable: true })
  holder!: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'filed_at', type: 'timestamptz', nullable: true })
  filedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  calls!: OriginalPodCall[];

  /** "Not traceable starts an indemnity bond." */
  @Column({ name: 'indemnity_bond_required', type: 'boolean', default: false })
  indemnityBondRequired!: boolean;

  /** Frozen once received; while it is out, the tracker works it out for today. */
  @Column({ name: 'penalty_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  penaltyAmount!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
