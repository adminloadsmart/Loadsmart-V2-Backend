import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { BrokerResponse, BrokerResponseChannel } from '../placement-board-rules';

/** Every response Placement logged from a broker on a load — a bid, a decline, no truck — in
 *  order. The live bid (ls_partner_bids) keeps only the latest rate; this is its history ("older
 *  offers remain in broker history"). */
@Entity({ schema: 'loads', name: 'ls_partner_bid_responses' })
@Index('ls_partner_bid_responses_sourcing_partner_idx', ['sourcingId', 'partnerId'])
export class LsPartnerBidResponseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId!: string;

  @Column({ type: 'varchar', length: 20 })
  response!: BrokerResponse;

  /** Null for a response without a rate (declined, no truck). */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  rate!: string | null;

  @Column({ type: 'varchar', length: 20 })
  channel!: BrokerResponseChannel;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'vehicle_number', type: 'varchar', length: 20, nullable: true })
  vehicleNumber!: string | null;

  @Column({ name: 'entered_by', type: 'uuid', nullable: true })
  enteredBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
