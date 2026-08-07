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
import { DriverEntity } from './driver.entity';

@Entity({ schema: 'masters', name: 'driver_trip_metrics' })
@Index('driver_trip_metrics_tenant_id_idx', ['tenantId'])
@Index('driver_trip_metrics_driver_id_idx', ['driverId'])
@Index('driver_trip_metrics_driver_period_unique', ['tenantId', 'driverId', 'periodStart', 'periodEnd'], { unique: true, where: '"deleted_at" IS NULL' })
export class DriverTripMetricsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.tripMetrics, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({ name: 'trips_count', type: 'int', default: 0 })
  tripsCount!: number;

  @Column({ name: 'on_time_percentage', type: 'numeric', precision: 5, scale: 2, default: 0 })
  onTimePercentage!: string;

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
