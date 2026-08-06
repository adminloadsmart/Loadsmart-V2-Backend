import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DriverEntity } from './driver.entity';
import { DRIVER_OPERATIONAL_STATUSES, DriverOperationalStatus } from '../utils/drivers.types';

@Entity({ schema: 'masters', name: 'driver_operational_statuses' })
@Index('driver_operational_statuses_tenant_id_idx', ['tenantId'])
@Index('driver_operational_statuses_driver_id_unique', ['driverId'], { unique: true, where: '"deleted_at" IS NULL' })
export class DriverOperationalStatusEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @OneToOne(() => DriverEntity, (driver) => driver.operationalStatus, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({
    name: 'operational_status',
    type: 'enum',
    enum: [...DRIVER_OPERATIONAL_STATUSES],
    default: 'active',
  })
  operationalStatus!: DriverOperationalStatus;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'effective_at', type: 'timestamptz', default: () => 'now()' })
  effectiveAt!: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
