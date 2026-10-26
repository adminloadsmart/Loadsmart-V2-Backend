import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { SOURCING_STATUSES, SourcingStatus } from '../loadsmart.types';
import { LsPartnerEntity } from './ls-partner.entity';

/**
 * Loadsmart's side of one market load (one truck): its approval and posting on the load board,
 * the bid Placement sends the shipper, and — once won — the partner on the truck, the partner's
 * rate and the driver documents the Verification team checks. Created when the load is posted.
 */
@Entity({ schema: 'loads', name: 'ls_sourcings' })
@Index('ls_sourcings_status_idx', ['status'])
export class LsSourcingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The shipper's tenant. */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid', unique: true })
  loadId!: string;

  @OneToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ type: 'enum', enum: [...SOURCING_STATUSES], default: 'pending_approval' })
  status!: SourcingStatus;

  @Column({ name: 'margin_percent', type: 'numeric', precision: 5, scale: 2 })
  marginPercent!: string;

  @Column({ name: 'trucker_advance_percent', type: 'numeric', precision: 5, scale: 2 })
  truckerAdvancePercent!: string;

  /** What the Approval team has to check ("flags anything missing"). */
  @Column({ name: 'missing_fields', type: 'jsonb', default: () => "'[]'" })
  missingFields!: string[];

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  /** When it went on the load board — Placement's 5-minute call list counts from here. */
  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 500, nullable: true })
  rejectionReason!: string | null;

  /** The rate partners see — the shipper's target with the margin taken out. */
  @Column({ name: 'partner_target_rate', type: 'numeric', precision: 12, scale: 2, nullable: true })
  partnerTargetRate!: string | null;

  /** Loadsmart's price to the shipper on the bid Placement sent. */
  @Column({ name: 'shipper_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  shipperPrice!: string | null;

  @Column({
    name: 'effective_margin_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  effectiveMarginPercent!: string | null;

  @Column({ name: 'negotiation_note', type: 'varchar', length: 500, nullable: true })
  negotiationNote!: string | null;

  @Column({ name: 'bid_sent_by', type: 'uuid', nullable: true })
  bidSentBy!: string | null;

  @Column({ name: 'bid_sent_at', type: 'timestamptz', nullable: true })
  bidSentAt!: Date | null;

  /** The partner on the truck once the shipper accepted Loadsmart's bid. */
  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  @ManyToOne(() => LsPartnerEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'partner_id' })
  partner!: LsPartnerEntity | null;

  @Column({ name: 'partner_bid_id', type: 'uuid', nullable: true })
  partnerBidId!: string | null;

  /** The partner's rate, in the load's freight basis. */
  @Column({ name: 'partner_rate', type: 'numeric', precision: 12, scale: 2, nullable: true })
  partnerRate!: string | null;

  // The driver's papers the partner sends: licence front and back, and the truck's RC copy.
  @Column({ name: 'licence_front_file_key', type: 'text', nullable: true })
  licenceFrontFileKey!: string | null;

  @Column({ name: 'licence_back_file_key', type: 'text', nullable: true })
  licenceBackFileKey!: string | null;

  @Column({ name: 'rc_copy_file_key', type: 'text', nullable: true })
  rcCopyFileKey!: string | null;

  @Column({ name: 'driver_named_at', type: 'timestamptz', nullable: true })
  driverNamedAt!: Date | null;

  @Column({ name: 'verification_approved_by', type: 'uuid', nullable: true })
  verificationApprovedBy!: string | null;

  @Column({ name: 'papers_approved_by', type: 'uuid', nullable: true })
  papersApprovedBy!: string | null;

  @Column({ name: 'original_pod_courier', type: 'varchar', length: 150, nullable: true })
  originalPodCourier!: string | null;

  @Column({ name: 'original_pod_tracking_number', type: 'varchar', length: 100, nullable: true })
  originalPodTrackingNumber!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
