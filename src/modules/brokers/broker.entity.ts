import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BrokerStatus } from './broker.types';

/** A broker — a carrier who sources trucks from others — and the escalation contact on loads they
 *  place. Platform-wide (no tenant). The loads / rating / POD figures are stored values for now:
 *  this table isn't linked to loads yet. */
@Entity({ schema: 'brokers', name: 'brokers' })
@Index('brokers_phone_uq', ['phone'], { unique: true })
@Index('brokers_status_idx', ['status'])
export class BrokerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The broker's firm — "Shyam Kripa Roadlines". */
  @Column({ name: 'trucker_company', type: 'varchar', length: 200 })
  truckerCompany!: string;

  /** The contact person at the firm. */
  @Column({ name: 'trucker_name', type: 'varchar', length: 150 })
  truckerName!: string;

  @Column({ type: 'varchar', length: 15 })
  phone!: string;

  @Column({ name: 'is_on_whatsapp', type: 'boolean', default: true })
  isOnWhatsapp!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  /** The city the broker operates from. */
  @Column({ type: 'varchar', length: 100 })
  base!: string;

  /** The trucks they source — "Open Body 20–24 ft", "Multi Axle 32 ft". */
  @Column({ name: 'truck_sources', type: 'text', array: true, default: () => "'{}'" })
  truckSources!: string[];

  /** Lane origin — "Rajasthan" in "Rajasthan → Punjab, NCR". */
  @Column({ name: 'lane_origin', type: 'varchar', length: 100 })
  laneOrigin!: string;

  @Column({ name: 'lane_destinations', type: 'text', array: true, default: () => "'{}'" })
  laneDestinations!: string[];

  @Column({ name: 'tds_percent', type: 'numeric', precision: 5, scale: 2, default: 1 })
  tdsPercent!: string;

  @Column({ name: 'loads_last_30_days', type: 'integer', default: 0 })
  loadsLast30Days!: number;

  /** Out of 5; null until they have a rated load. */
  @Column({ type: 'numeric', precision: 2, scale: 1, nullable: true })
  rating!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'awaiting_approval' })
  status!: BrokerStatus;

  /** Why the broker is on hold — "PAN name mismatch". */
  @Column({ name: 'hold_reason', type: 'varchar', length: 200, nullable: true })
  holdReason!: string | null;

  /** Original PODs the broker hasn't returned 15+ days after delivery. */
  @Column({ name: 'pending_original_pods', type: 'integer', default: 0 })
  pendingOriginalPods!: number;

  /** "Proprietorship", "Partnership", "Private Limited"… */
  @Column({ name: 'business_type', type: 'varchar', length: 40, nullable: true })
  businessType!: string | null;

  @Column({ name: 'pan_number', type: 'varchar', length: 10, nullable: true })
  panNumber!: string | null;

  /** The PAN API confirmed the PAN is active. */
  @Column({ name: 'pan_verified', type: 'boolean', default: false })
  panVerified!: boolean;

  /** Only the last 4 digits — the full Aadhaar number is never stored. */
  @Column({ name: 'aadhaar_last4', type: 'varchar', length: 4, nullable: true })
  aadhaarLast4!: string | null;

  @Column({ name: 'aadhaar_linked_to_pan', type: 'boolean', default: false })
  aadhaarLinkedToPan!: boolean;

  /** The area sales manager — a name only for now. */
  @Column({ name: 'asm_name', type: 'varchar', length: 150, nullable: true })
  asmName!: string | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
