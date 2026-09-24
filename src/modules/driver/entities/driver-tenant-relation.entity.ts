import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { DriverEntity } from './driver.entity';
import { DriverOperationalStatusEntity } from './driver-operational-status.entity';
import { DriverTripMetricsEntity } from './driver-trip-metrics.entity';
import { FleetDriverLinkEntity } from '../../masters/fleet-driver-link/entities/fleet-driver-link.entity';
import {
  DRIVER_TENANT_RELATION_INITIATORS,
  DRIVER_TENANT_RELATION_STATUSES,
  DriverTenantRelationInitiator,
  DriverTenantRelationStatus,
} from '../drivers.types';

// The tenant-scoped employment/membership record a global DriverEntity used to be. Everything
// employer-specific (salary, dateOfJoining) and the mutual-approval workflow (staff onboarding,
// fleet-owner invite, driver join-request — see DRIVER_TENANT_RELATION_STATUSES) lives here so one
// driver profile can be linked, independently, to many tenants.
@Entity({ schema: 'masters', name: 'driver_tenant_relations' })
@Index('driver_tenant_relations_tenant_id_idx', ['tenantId'])
@Index('driver_tenant_relations_driver_id_idx', ['driverId'])
// One live-or-pending relation per tenant per driver; unlimited relations across different tenants.
@Index('driver_tenant_relations_tenant_driver_live_unique', ['tenantId', 'driverId'], {
  unique: true,
  where:
    "\"deleted_at\" IS NULL AND \"status\" IN ('pending_staff_review', 'pending_driver_review', 'active')",
})
export class DriverTenantRelationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.tenantRelations, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({
    type: 'enum',
    enum: [...DRIVER_TENANT_RELATION_STATUSES],
    default: 'active',
  })
  status!: DriverTenantRelationStatus;

  @Column({ name: 'initiated_by', type: 'enum', enum: [...DRIVER_TENANT_RELATION_INITIATORS] })
  initiatedBy!: DriverTenantRelationInitiator;

  // auth.users id when initiatedBy is 'staff' or 'fleet_owner'; null when 'driver' (driverId
  // already identifies the actor).
  @Column({ name: 'initiated_by_user_id', type: 'uuid', nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'driver_responded_at', type: 'timestamptz', nullable: true })
  driverRespondedAt!: Date | null;

  @Column({ name: 'fleet_owner_responded_at', type: 'timestamptz', nullable: true })
  fleetOwnerRespondedAt!: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  // Set by reject, cleared by approve — mirrors the old DriverEntity.rejectionReason.
  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;

  @OneToOne(() => DriverOperationalStatusEntity, (status) => status.driverTenantRelation)
  operationalStatus!: DriverOperationalStatusEntity;

  @OneToMany(() => DriverTripMetricsEntity, (metric) => metric.driverTenantRelation)
  tripMetrics!: DriverTripMetricsEntity[];

  @OneToMany(() => FleetDriverLinkEntity, (link) => link.driverTenantRelation)
  vehicleLinks!: FleetDriverLinkEntity[];

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
