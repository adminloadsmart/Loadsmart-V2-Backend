import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { VehicleEntity } from './vehicle.entity';
import { DriverEntity } from './driver.entity';
import { FLEET_DRIVER_LINK_STATUSES, FleetDriverLinkStatus } from '../utils/fleet-driver-link.type';

@Entity({ schema: 'masters', name: 'fleet_driver_links' })
@Index('fleet_driver_links_tenant_id_idx', ['tenantId'])
@Index('fleet_driver_links_vehicle_id_idx', ['vehicleId'])
@Index('fleet_driver_links_driver_id_idx', ['driverId'])
// Backs "at most one primary driver per vehicle" (see fleet-driver-link.service.ts's linkDriver/
// setPrimaryDriver) at the DB level — those methods already check-then-act inside a transaction,
// but two concurrent calls against the same vehicle can each pass that check before either
// commits. This turns that race into a clean unique-violation instead of two simultaneously
// active primary links.
@Index('fleet_driver_links_vehicle_active_primary_unique', ['tenantId', 'vehicleId'], {
  unique: true,
  where: '"is_primary" = true AND "status" = \'active\' AND "deleted_at" IS NULL',
})
export class FleetDriverLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, (vehicle) => vehicle.driverLinks, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.vehicleLinks, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({ name: 'is_primary', type: 'boolean', default: true })
  isPrimary!: boolean;

  @Column({ name: 'linked_from', type: 'date', default: () => 'current_date' })
  linkedFrom!: string;

  @Column({ name: 'linked_to', type: 'date', nullable: true })
  linkedTo!: string | null;

  @Column({ type: 'enum', enum: [...FLEET_DRIVER_LINK_STATUSES], default: 'active' })
  status!: FleetDriverLinkStatus;

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
