import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { VehicleDocumentEntity } from './vehicle-document.entity';
import { FleetDriverLinkEntity } from './fleet-driver-link.entity';
import { TruckTypeEntity } from './truck-type.entity';
import {
  BODY_TYPES,
  FUEL_TYPES,
  OWNERSHIP_TYPES,
  VEHICLE_STATUSES,
  VehicleBodyType,
  VehicleFuelType,
  VehicleOwnershipType,
  VehicleStatus,
} from '../utils/vehicle.type';

import { VehicleOperationalStatusEntity } from './vehicle-operational-status.entity';
import { VehicleTelemetryMetaEntity } from './vehicle-telemetry-meta.entity';
import { VehicleVerificationSnapshotEntity } from './vehicle-verification-snapshot.entity';
import { VehicleServiceUsageEntity } from './vehicle-service-usage.entity';

@Entity({ schema: 'masters', name: 'vehicles' })
@Index('vehicles_tenant_id_idx', ['tenantId'])
@Index('vehicles_tenant_registration_active_unique', ['tenantId', 'registrationNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class VehicleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'registration_number', type: 'varchar', length: 20 })
  registrationNumber!: string;

  @Column({ name: 'truck_type_id', type: 'uuid', nullable: true })
  truckTypeId!: string | null;

  @ManyToOne(() => TruckTypeEntity, (truckType) => truckType.vehicles, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'truck_type_id' })
  truckType!: TruckTypeEntity | null;

  @Column({
    name: 'fuel_type',
    type: 'enum',
    enum: [...FUEL_TYPES],
    nullable: true,
  })
  fuelType!: VehicleFuelType | null;

  @Column({
    name: 'body_type',
    type: 'enum',
    enum: [...BODY_TYPES],
    nullable: true,
  })
  bodyType!: VehicleBodyType | null;

  @Column({ name: 'wheel_count', type: 'smallint', nullable: true })
  wheelCount!: number | null;

  @Column({
    name: 'capacity_tons',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  capacityTons!: string | null;

  @Column({
    name: 'ownership_type',
    type: 'enum',
    enum: [...OWNERSHIP_TYPES],
    default: 'owned',
  })
  ownershipType!: VehicleOwnershipType;

  @Column({
    type: 'enum',
    enum: [...VEHICLE_STATUSES],
    default: 'active',
  })
  status!: VehicleStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  // Set by reject, cleared by approve — mirrors CustomerEntity.rejectionReason.
  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;

  @OneToMany(() => VehicleDocumentEntity, (document) => document.vehicle)
  documents!: VehicleDocumentEntity[];

  @OneToMany(() => FleetDriverLinkEntity, (link) => link.vehicle)
  driverLinks!: FleetDriverLinkEntity[];

  @OneToOne(() => VehicleOperationalStatusEntity, (status) => status.vehicle)
  operationalStatus!: VehicleOperationalStatusEntity;

  @OneToOne(() => VehicleTelemetryMetaEntity, (meta) => meta.vehicle)
  telemetryMeta!: VehicleTelemetryMetaEntity;

  @OneToMany(() => VehicleVerificationSnapshotEntity, (snapshot) => snapshot.vehicle)
  verificationSnapshots!: VehicleVerificationSnapshotEntity[];

  @OneToOne(() => VehicleServiceUsageEntity, (usage) => usage.vehicle)
  serviceUsage!: VehicleServiceUsageEntity;

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
