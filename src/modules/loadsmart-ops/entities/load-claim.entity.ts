import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  CLAIM_RECOVERY_MODES,
  CLAIM_STATUSES,
  ClaimRecoveryMode,
  ClaimStatus,
} from '../loadsmart.types';

/** The claim on a Loadsmart load delivered with damage, shortage, pilferage or another issue
 *  (C01). The shipper adds the amount claimed; Customer support assesses it, agrees an amount and
 *  says who bears it (the carrier's balance, split, or Loadsmart). Closing it issues Loadsmart's
 *  credit note to the shipper and passes the carrier's share to Payables. Billing never waits for
 *  it; the carrier's balance does. */
@Entity({ schema: 'loads', name: 'load_claims' })
export class LoadClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid', unique: true })
  loadId!: string;

  @Column({ type: 'enum', enum: [...CLAIM_STATUSES], default: 'open' })
  status!: ClaimStatus;

  /** What the POD noted — shortage, damage, wet, both or pilferage. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  issue!: string | null;

  /** The shipper's claimed amount, entered in the app. */
  @Column({ name: 'claim_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  claimValue!: string | null;

  @Column({ name: 'shipper_note', type: 'varchar', length: 500, nullable: true })
  shipperNote!: string | null;

  /** The carrier's share of the agreed amount — deducted from its balance. */
  @Column({ name: 'partner_recovery', type: 'numeric', precision: 12, scale: 2, nullable: true })
  partnerRecovery!: string | null;

  /** Tracking assigns a CS agent to each claim; unassigned claims are flagged. */
  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo!: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  /** CS's own view of the loss. */
  @Column({ name: 'cs_assessment', type: 'numeric', precision: 12, scale: 2, nullable: true })
  csAssessment!: string | null;

  /** What Loadsmart credits the shipper — mandatory to close. */
  @Column({ name: 'agreed_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  agreedAmount!: string | null;

  @Column({
    name: 'recovery_mode',
    type: 'enum',
    enum: [...CLAIM_RECOVERY_MODES],
    nullable: true,
  })
  recoveryMode!: ClaimRecoveryMode | null;

  /** The part Loadsmart absorbs. */
  @Column({ name: 'loadsmart_share', type: 'numeric', precision: 12, scale: 2, nullable: true })
  loadsmartShare!: string | null;

  /** The shipper's debit note for the deduction, if it sent one. */
  @Column({ name: 'shipper_debit_note_ref', type: 'varchar', length: 100, nullable: true })
  shipperDebitNoteRef!: string | null;

  /** Every step: assigned, assessed, evidence added, closed. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: { at: string; by: string; step: string; detail?: Record<string, unknown> }[];

  @Column({ name: 'resolution_note', type: 'varchar', length: 1000, nullable: true })
  resolutionNote!: string | null;

  @Column({ name: 'settled_by', type: 'uuid', nullable: true })
  settledBy!: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
