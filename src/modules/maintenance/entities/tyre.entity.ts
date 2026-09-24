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
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import {
  TYRE_CASING_CONDITIONS,
  TYRE_REMOVAL_REASONS,
  TYRE_STATUSES,
  TyreCasingCondition,
  TyreRemovalReason,
  TyreStatus,
} from '../maintenance.types';
import { TyreReadingEntity } from './tyre-reading.entity';

/**
 * One tyre fitment at one wheel position. A retreaded casing going back on is registered as a new
 * fitment carrying its retread_count, so each row's tread history starts from its own
 * original_tread_mm.
 */
@Entity({ schema: 'maintenance', name: 'tyres' })
@Index('tyres_tenant_id_idx', ['tenantId'])
@Index('tyres_vehicle_id_idx', ['vehicleId'])
// One tyre per wheel position at a time.
@Index('tyres_vehicle_position_fitted_unique', ['vehicleId', 'position'], {
  unique: true,
  where: `"status" = 'fitted'`,
})
export class TyreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  /** Free-form wheel position code, e.g. "FL", "FR", "R1-LO" (rear axle 1, left outer). */
  @Column({ type: 'varchar', length: 20 })
  position!: string;

  @Column({ name: 'serial_number', type: 'varchar', length: 50, nullable: true })
  serialNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand!: string | null;

  @Column({ name: 'original_tread_mm', type: 'numeric', precision: 4, scale: 1 })
  originalTreadMm!: string;

  @Column({ name: 'fitted_at', type: 'date' })
  fittedAt!: string;

  @Column({ name: 'fitted_odometer_km', type: 'int' })
  fittedOdometerKm!: number;

  @Column({ name: 'retread_count', type: 'smallint', default: 0 })
  retreadCount!: number;

  @Column({ name: 'max_retreads', type: 'smallint', default: 2 })
  maxRetreads!: number;

  @Column({
    name: 'casing_condition',
    type: 'enum',
    enum: [...TYRE_CASING_CONDITIONS],
    default: 'ok',
  })
  casingCondition!: TyreCasingCondition;

  @Column({ type: 'enum', enum: [...TYRE_STATUSES], default: 'fitted' })
  status!: TyreStatus;

  @Column({ name: 'removed_at', type: 'date', nullable: true })
  removedAt!: string | null;

  @Column({ name: 'removed_odometer_km', type: 'int', nullable: true })
  removedOdometerKm!: number | null;

  @Column({
    name: 'removed_reason',
    type: 'enum',
    enum: [...TYRE_REMOVAL_REASONS],
    nullable: true,
  })
  removedReason!: TyreRemovalReason | null;

  @OneToMany(() => TyreReadingEntity, (reading) => reading.tyre)
  readings!: TyreReadingEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
