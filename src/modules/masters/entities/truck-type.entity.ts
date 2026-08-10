import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { VehicleEntity } from './vehicle.entity';

/**
 * Per-tenant truck-type master ("Settings → Truck Types"). Replaces the old fixed VEHICLE_TYPES
 * enum: each org supplies its own exhaustive list (free-text names like "45 Feet Container"),
 * so this can't be a Postgres enum — it's real per-tenant data, referenced by
 * VehicleEntity.truckTypeId.
 */
@Entity({ schema: 'masters', name: 'truck_types' })
@Index('truck_types_tenant_id_idx', ['tenantId'])
@Index('truck_types_tenant_name_active_unique', ['tenantId', 'name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class TruckTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Backs the "IN FLEET" column — see truck-type.repository.ts's use of loadRelationCountAndMap. */
  @OneToMany(() => VehicleEntity, (vehicle) => vehicle.truckType)
  vehicles!: VehicleEntity[];

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
