import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CLAIM_STATUSES, ClaimStatus } from '../loadsmart.types';

/** The CS ticket for a Loadsmart load delivered with damage, shortage or pilferage. The shipper
 *  adds the claim value; the CS team settles it with the partner (what is recovered from the
 *  partner's balance). The partner's balance and the shipper's invoice wait until it's settled. */
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

  /** Credited to the shipper on the invoice. */
  @Column({ name: 'claim_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  claimValue!: string | null;

  @Column({ name: 'shipper_note', type: 'varchar', length: 500, nullable: true })
  shipperNote!: string | null;

  /** Deducted from the partner's balance. */
  @Column({ name: 'partner_recovery', type: 'numeric', precision: 12, scale: 2, nullable: true })
  partnerRecovery!: string | null;

  @Column({ name: 'resolution_note', type: 'varchar', length: 1000, nullable: true })
  resolutionNote!: string | null;

  @Column({ name: 'settled_by', type: 'uuid', nullable: true })
  settledBy!: string | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
