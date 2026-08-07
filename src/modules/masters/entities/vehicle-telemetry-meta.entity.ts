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

@Entity({ schema: 'masters', name: 'vehicle_telemetry_meta' })
@Index('vehicle_telemetry_meta_tenant_id_idx', ['tenantId'])
@Index('vehicle_telemetry_meta_vehicle_id_unique', ['vehicleId'], { unique: true, where: '"deleted_at" IS NULL' })
export class VehicleTelemetryMetaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @OneToOne(() => VehicleEntity, (vehicle) => vehicle.telemetryMeta, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'gps_provider', type: 'varchar', length: 100, nullable: true })
  gpsProvider!: string | null;

  @Column({ name: 'gps_enabled', type: 'boolean', default: false })
  gpsEnabled!: boolean;

  @Column({ name: 'emi_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  emiAmount!: string | null;

  @Column({ name: 'emi_end_date', type: 'date', nullable: true })
  emiEndDate!: string | null;

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
