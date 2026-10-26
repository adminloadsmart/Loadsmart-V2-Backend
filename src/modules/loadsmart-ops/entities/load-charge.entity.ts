import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  CHARGE_RAISERS,
  CHARGE_STATUSES,
  CHARGE_TYPES,
  ChargeRaiser,
  ChargeStatus,
  ChargeType,
} from '../loadsmart.types';

/** A loading, unloading or detention charge on a Loadsmart load. Loadsmart's team raises it and
 *  the shipper approves it; the shipper can also enter the unloading amount agreed with the
 *  receiver, which counts as approved. An approved charge goes on the shipper's invoice and on
 *  the partner's balance. */
@Entity({ schema: 'loads', name: 'load_charges' })
@Index('load_charges_tenant_load_idx', ['tenantId', 'loadId'])
export class LoadChargeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'charge_type', type: 'enum', enum: [...CHARGE_TYPES] })
  chargeType!: ChargeType;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
