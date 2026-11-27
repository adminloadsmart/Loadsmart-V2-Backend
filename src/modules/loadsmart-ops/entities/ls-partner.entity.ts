import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerEntity } from '../../loads/brokers/broker.entity';
import { LsPartnerLaneEntity } from './ls-partner-lane.entity';
import { LsPartnerTruckTypeEntity } from './ls-partner-truck-type.entity';
import { PARTNER_STATUSES, PARTNER_TYPES, PartnerStatus, PartnerType } from '../loadsmart.types';

/** One of Loadsmart's partners — a fleet owner or broker it sources trucks from. Platform-wide
 *  (no tenant): the same partner serves every shipper's Loadsmart loads. */
@Entity({ schema: 'loads', name: 'ls_partners' })
@Index('ls_partners_broker_uq', ['brokerId'], { unique: true, where: '"broker_id" IS NOT NULL' })
export class LsPartnerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 15 })
  phone!: string;

  /** The loads.brokers row this partner stands for — brokers are the master Placement matches
   *  loads against (lane-matching); a matched broker gets this partner row for its bids. */
  @Column({ name: 'broker_id', type: 'uuid', nullable: true })
  brokerId!: string | null;

  @ManyToOne(() => BrokerEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'broker_id', foreignKeyConstraintName: 'FK_ls_partners_broker' })
  broker?: BrokerEntity | null;

  @Column({ name: 'partner_type', type: 'enum', enum: [...PARTNER_TYPES] })
  partnerType!: PartnerType;

  @Column({ type: 'enum', enum: [...PARTNER_STATUSES], default: 'active' })
  status!: PartnerStatus;

  /** TDS deducted on the partner's payments (194C) — 0 when a no-TDS declaration is on file. */
  @Column({ name: 'tds_percent', type: 'numeric', precision: 5, scale: 2, default: 1 })
  tdsPercent!: string;

  @Column({ name: 'bank_account_name', type: 'varchar', length: 150, nullable: true })
  bankAccountName!: string | null;

  @Column({ name: 'bank_name', type: 'varchar', length: 100, nullable: true })
  bankName!: string | null;

  @Column({ name: 'bank_account_number', type: 'varchar', length: 30, nullable: true })
  bankAccountNumber!: string | null;

  @Column({ name: 'bank_ifsc', type: 'varchar', length: 11, nullable: true })
  bankIfsc!: string | null;

  @Column({ name: 'upi_id', type: 'varchar', length: 100, nullable: true })
  upiId!: string | null;

  /** The carrier's advance on loading when it isn't the settings' default (90%) — 85% or 80%,
   *  set only with Super Admin's permission (loadsmart.money.approve). */
  @Column({ name: 'advance_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercent!: string | null;

  /** Approval's note for Placement. */
  @Column({ name: 'note_for_placement', type: 'text', nullable: true })
  noteForPlacement!: string | null;

  /** The trucker salesperson — a contact only (the sales app is parked). */
  @Column({ name: 'trucker_sales_name', type: 'varchar', length: 150, nullable: true })
  truckerSalesName!: string | null;

  @Column({ name: 'trucker_sales_phone', type: 'varchar', length: 15, nullable: true })
  truckerSalesPhone!: string | null;

  @OneToMany(() => LsPartnerLaneEntity, (lane) => lane.partner)
  lanes?: LsPartnerLaneEntity[];

  @OneToMany(() => LsPartnerTruckTypeEntity, (truckType) => truckType.partner)
  truckTypes?: LsPartnerTruckTypeEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
