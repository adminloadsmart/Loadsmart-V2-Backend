import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoadEntity } from '../entities/load.entity';
import { MEMO_STATUSES, MemoStatus } from '../utils/loads.types';

/**
 * The load memo: once the transporter has named the driver, the shipper gets the truck and driver
 * to accept. It expires 1 hour after it is sent and only the shipper can accept it; a fresh one
 * can be sent after that. Each row snapshots what the shipper saw. Accepting stamps
 * LoadEntity.memoAcceptedAt, which the trip start waits on.
 */
@Entity({ schema: 'loads', name: 'load_memos' })
@Index('load_memos_tenant_load_idx', ['tenantId', 'loadId'])
export class LoadMemoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ type: 'enum', enum: [...MEMO_STATUSES], default: 'sent' })
  status!: MemoStatus;

  @Column({ name: 'transporter_id', type: 'uuid', nullable: true })
  transporterId!: string | null;

  @Column({ name: 'vehicle_number', type: 'varchar', length: 20 })
  vehicleNumber!: string;

  @Column({ name: 'driver_name', type: 'varchar', length: 150 })
  driverName!: string;

  @Column({ name: 'driver_mobile', type: 'varchar', length: 20 })
  driverMobile!: string;

  /** Who meets the truck at the loading point — from the loading point master, and the shipper
   *  can change it when accepting. */
  @Column({ name: 'loading_contact_name', type: 'varchar', length: 150, nullable: true })
  loadingContactName!: string | null;

  @Column({ name: 'loading_contact_phone', type: 'varchar', length: 20, nullable: true })
  loadingContactPhone!: string | null;

  /** The shipper's change to the loading point (gate, dock, alternate address) when accepting. */
  @Column({ name: 'loading_point_note', type: 'varchar', length: 300, nullable: true })
  loadingPointNote!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'accepted_by', type: 'uuid', nullable: true })
  acceptedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
