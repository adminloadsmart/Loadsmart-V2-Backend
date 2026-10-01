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
import { DriverTenantRelationEntity } from './driver-tenant-relation.entity';
import { DRIVER_OPERATIONAL_STATUSES, DriverOperationalStatus } from '../drivers.types';

// "What the driver is doing right now" is per-employment, not per-person — a driver can be on_trip
// for one tenant and idle for another — so this hangs off the tenant relation, not the global
// driver profile.
@Entity({ schema: 'masters', name: 'driver_operational_statuses' })
@Index('driver_operational_statuses_tenant_id_idx', ['tenantId'])
@Index('driver_operational_statuses_relation_id_unique', ['driverTenantRelationId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class DriverOperationalStatusEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_tenant_relation_id', type: 'uuid' })
  driverTenantRelationId!: string;

  @OneToOne(() => DriverTenantRelationEntity, (relation) => relation.operationalStatus, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'driver_tenant_relation_id' })
  driverTenantRelation!: DriverTenantRelationEntity;

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
