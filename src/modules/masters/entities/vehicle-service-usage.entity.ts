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
import { VehicleEntity } from './vehicle.entity';

/** Backs the "Service & usage" section of the vehicle form; feeds the maintenance reminders. */
@Entity({ schema: 'masters', name: 'vehicle_service_usage' })
@Index('vehicle_service_usage_tenant_id_idx', ['tenantId'])
@Index('vehicle_service_usage_vehicle_id_unique', ['vehicleId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class VehicleServiceUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @OneToOne(() => VehicleEntity, (vehicle) => vehicle.serviceUsage, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'odometer_km', type: 'int', nullable: true })
  odometerKm!: number | null;

  @Column({ name: 'last_service_date', type: 'date', nullable: true })
  lastServiceDate!: string | null;

  @Column({ name: 'last_service_odometer_km', type: 'int', nullable: true })
  lastServiceOdometerKm!: number | null;

  @Column({ name: 'last_tyre_change_brand', type: 'varchar', length: 100, nullable: true })
  lastTyreChangeBrand!: string | null;

  @Column({ name: 'last_tyre_change_date', type: 'date', nullable: true })
  lastTyreChangeDate!: string | null;

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
