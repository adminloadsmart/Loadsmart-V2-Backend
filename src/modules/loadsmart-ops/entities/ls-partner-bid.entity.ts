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
import { PARTNER_BID_STATUSES, PartnerBidStatus } from '../loadsmart.types';
import { LsPartnerEntity } from './ls-partner.entity';
import { LsSourcingEntity } from './ls-sourcing.entity';

/** A partner's rate and truck for a load on Loadsmart's board, as Placement entered it. One live
 *  bid per partner per load — quoting again revises it. */
@Entity({ schema: 'loads', name: 'ls_partner_bids' })
@Index('ls_partner_bids_sourcing_idx', ['sourcingId'])
export class LsPartnerBidEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @ManyToOne(() => LsSourcingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourcing_id' })
  sourcing!: LsSourcingEntity;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId!: string;

  @ManyToOne(() => LsPartnerEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'partner_id' })
  partner!: LsPartnerEntity;

  /** In the load's freight basis, with Loadsmart's margin already out (what the partner earns). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  rate!: string;

  @Column({ name: 'vehicle_number', type: 'varchar', length: 20, nullable: true })
  vehicleNumber!: string | null;

  @Column({ name: 'truck_verified', type: 'boolean', nullable: true })
  truckVerified!: boolean | null;

  @Column({ type: 'enum', enum: [...PARTNER_BID_STATUSES], default: 'received' })
  status!: PartnerBidStatus;

  @Column({ name: 'entered_by', type: 'uuid', nullable: true })
  enteredBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
