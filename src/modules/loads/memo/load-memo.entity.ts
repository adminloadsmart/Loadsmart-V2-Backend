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
import {
  FREIGHT_TYPES,
  FreightType,
  MEMO_ACCEPT_CHANNELS,
  MEMO_STATUSES,
  MemoAcceptChannel,
  MemoStatus,
} from '../utils/loads.types';

/**
 * The load memo — "the only confirmation" of truck, driver and price. Once the driver is named and
 * every check passed, a version goes to the shipper (LM-<load code>-v1, v2…); a changed truck or
 * driver, or a resend, is the next version and supersedes the open one. It expires per the load's
 * settings; the shipper accepts it (or, on a Loadsmart load, Placement confirms it after a call),
 * which moves the load to Truck assigned. Each row snapshots what the shipper saw, with its PDF.
 */
@Entity({ schema: 'loads', name: 'load_memos' })
@Index('load_memos_tenant_load_idx', ['tenantId', 'loadId'])
@Index('load_memos_load_version_unique', ['loadId', 'version'], { unique: true })
export class LoadMemoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ type: 'enum', enum: [...MEMO_STATUSES], default: 'sent' })
  status!: MemoStatus;

  /** 1, 2, … per load. */
  @Column({ type: 'integer' })
  version!: number;

  /** "LM-<load code>-v<version>". */
  @Column({ type: 'varchar', length: 60 })
  reference!: string;

  @Column({ name: 'driver_licence_number', type: 'varchar', length: 30, nullable: true })
  driverLicenceNumber!: string | null;

  /** The agreed price and payment terms, as on the load when the memo went out. */
  @Column({
    name: 'freight_type',
    type: 'enum',
    enum: [...FREIGHT_TYPES],
    enumName: 'loads_freight_type_enum',
    nullable: true,
  })
  freightType!: FreightType | null;

  @Column({ name: 'freight_value', type: 'numeric', precision: 12, scale: 2, nullable: true })
  freightValue!: string | null;

  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;

  @Column({ name: 'balance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  balancePercentage!: string | null;

  /** The system-generated PDF of this version. */
  @Column({ name: 'pdf_file_key', type: 'text', nullable: true })
  pdfFileKey!: string | null;

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

  @Column({ name: 'accepted_via', type: 'enum', enum: [...MEMO_ACCEPT_CHANNELS], nullable: true })
  acceptedVia!: MemoAcceptChannel | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
