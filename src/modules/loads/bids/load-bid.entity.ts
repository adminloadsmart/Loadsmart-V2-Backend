import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { LoadEntity } from '../entities/load.entity';
import { BID_CHANNELS, BID_STATUSES, BidChannel, BidStatus } from '../utils/loads.types';

/**
 * One transporter's quote for one load (one truck). Market loads collect these from the
 * transporters the posting went to; an indent load gets exactly one, the contracted transporter's
 * acceptance at the contract rate. Accepting a bid moves the load to Truck assigned with the bid's
 * transporter, truck and rate. A transporter revising its quote updates its live bid rather than
 * adding another (partial unique index on load + transporter while `received`).
 */
@Entity({ schema: 'loads', name: 'load_bids' })
@Index('load_bids_tenant_load_idx', ['tenantId', 'loadId'])
export class LoadBidEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  /** The posting recipient row the bid answers; null for a load with no posting. */
  @Column({ name: 'recipient_id', type: 'uuid', nullable: true })
  recipientId!: string | null;

  @Column({ name: 'transporter_id', type: 'uuid' })
  transporterId!: string;

  @ManyToOne(() => TransporterEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;

  /** In the load's own freight basis (LoadEntity.freightType: per tonne or per trip). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  rate!: string;

  /** "No truck number, no bid" — a bid without one is shown but can't be accepted. */
  @Column({ name: 'vehicle_number', type: 'varchar', length: 20, nullable: true })
  vehicleNumber!: string | null;

  /** Govt-portal check on the truck: null until it has run (Phase 3), then pass/fail. */
  @Column({ name: 'truck_verified', type: 'boolean', nullable: true })
  truckVerified!: boolean | null;

  @Column({ type: 'enum', enum: [...BID_CHANNELS], default: 'web' })
  channel!: BidChannel;

  @Column({ type: 'enum', enum: [...BID_STATUSES], default: 'received' })
  status!: BidStatus;

  /** Null for indent — the contract has no bidding window. */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  /** The shipper who typed in a rate given by phone, and why — logged with their name. */
  @Column({ name: 'entered_by', type: 'uuid', nullable: true })
  enteredBy!: string | null;

  @Column({ name: 'entry_reason', type: 'varchar', length: 500, nullable: true })
  entryReason!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
