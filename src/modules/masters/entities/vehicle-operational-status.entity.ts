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
import { VEHICLE_OPERATIONAL_STATUSES, VehicleOperationalStatus } from '../utils/vehicle.type';

@Entity({ schema: 'masters', name: 'vehicle_operational_statuses' })
@Index('vehicle_operational_statuses_tenant_id_idx', ['tenantId'])
@Index('vehicle_operational_statuses_vehicle_id_unique', ['vehicleId'], { unique: true, where: '"deleted_at" IS NULL' })
export class VehicleOperationalStatusEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @OneToOne(() => VehicleEntity, (vehicle) => vehicle.operationalStatus, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({
    name: 'operational_status',
    type: 'enum',
    enum: [...VEHICLE_OPERATIONAL_STATUSES],
    default: 'idle',
  })
  operationalStatus!: VehicleOperationalStatus;

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
