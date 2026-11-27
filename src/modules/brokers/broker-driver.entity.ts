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
import { BrokerEntity } from './broker.entity';

export const BROKER_DRIVER_STATUSES = ['active', 'inactive'] as const;
export type BrokerDriverStatus = (typeof BROKER_DRIVER_STATUSES)[number];

/** A driver a broker puts on Loadsmart loads (Masters → Drivers). One row per broker and licence:
 *  the same driver can drive for several brokers. Placement's "Verify truck and driver" adds or
 *  refreshes the row; the Admin team can add and edit drivers here too. The Sarathi verdict is not
 *  copied — it is read from the latest loads.load_verifications check of the licence. */
@Entity({ schema: 'brokers', name: 'broker_drivers' })
@Index('broker_drivers_broker_licence_uq', ['brokerId', 'licenceNumber'], { unique: true })
@Index('broker_drivers_licence_idx', ['licenceNumber'])
export class BrokerDriverEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'broker_id', type: 'uuid' })
  brokerId!: string;

  @ManyToOne(() => BrokerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_id', foreignKeyConstraintName: 'FK_broker_drivers_broker' })
  broker?: BrokerEntity;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'varchar', length: 15 })
  mobile!: string;

  @Column({ name: 'is_on_whatsapp', type: 'boolean', default: true })
  isOnWhatsapp!: boolean;

  /** Upper-case, no spaces — "UP2120040012345". */
  @Column({ name: 'licence_number', type: 'varchar', length: 30 })
  licenceNumber!: string;

  /** `YYYY-MM-DD` — Sarathi needs it with the licence number. */
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ name: 'licence_front_file_key', type: 'text', nullable: true })
  licenceFrontFileKey!: string | null;

  @Column({ name: 'licence_back_file_key', type: 'text', nullable: true })
  licenceBackFileKey!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: BrokerDriverStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
