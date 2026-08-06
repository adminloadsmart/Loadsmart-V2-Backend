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
import { VehicleEntity } from './vehicle.entity';
import { VEHICLE_VERIFICATION_STATUSES, VEHICLE_VERIFICATION_TYPES, VehicleVerificationStatus, VehicleVerificationType } from '../utils/vehicle.type';

@Entity({ schema: 'masters', name: 'vehicle_verification_snapshots' })
@Index('vehicle_verification_snapshots_tenant_id_idx', ['tenantId'])
@Index('vehicle_verification_snapshots_vehicle_id_idx', ['vehicleId'])
@Index('vehicle_verification_snapshots_checked_at_idx', ['checkedAt'])
export class VehicleVerificationSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, (vehicle) => vehicle.verificationSnapshots, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({
    name: 'verification_type',
    type: 'enum',
    enum: [...VEHICLE_VERIFICATION_TYPES],
    default: 'vahan',
  })
  verificationType!: VehicleVerificationType;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: [...VEHICLE_VERIFICATION_STATUSES],
    default: 'pending',
  })
  verificationStatus!: VehicleVerificationStatus;

  @Column({ name: 'source_reference', type: 'varchar', length: 100, nullable: true })
  sourceReference!: string | null;

  /*
   * Registry details, typed rather than left in `responsePayload` so they can be queried and so the
   * manual route has somewhere to put what the operator keys in. Mirrors DriverVerificationEntity.
   */

  @Column({ name: 'registered_name', type: 'varchar', length: 150, nullable: true })
  registeredName!: string | null;

  @Column({ name: 'registered_on', type: 'date', nullable: true })
  registeredOn!: string | null;

  @Column({ name: 'vehicle_class', type: 'varchar', length: 100, nullable: true })
  vehicleClass!: string | null;

  @Column({ name: 'address_line1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ name: 'pin_code', type: 'varchar', length: 10, nullable: true })
  pinCode!: string | null;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload!: Record<string, unknown> | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'checked_at', type: 'timestamptz', default: () => 'now()' })
  checkedAt!: Date;

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
