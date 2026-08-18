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
import { TRUCK_BODY_TYPES, TruckBodyType } from '../utils/truck-type.types';

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

  // --- Structured picker fields (Plan Dispatch v2.0 §6.6) — nullable: rows created via the
  // "Add from catalog" bulk-by-name flow (truck-type.service.ts's addFromCatalog) have none of
  // these set until an org_admin edits them; only the direct 3-step-picker POST /truck-types
  // requires all four. Dispatch Planning's market-line capacity check (loads/dispatch-planning.
  // service.ts) rejects a truck type with no capacityTons set, rather than the DB enforcing NOT
  // NULL — see masters.validators.ts's createTruckType for where these are actually required.

  @Column({ name: 'body_type', type: 'enum', enum: [...TRUCK_BODY_TYPES], nullable: true })
  bodyType!: TruckBodyType | null;

  /** Axle/wheel count — reuses masters/utils/vehicle.type.ts's WHEEL_COUNTS value set. */
  @Column({ name: 'wheel_configuration', type: 'smallint', nullable: true })
  wheelConfiguration!: number | null;

  @Column({ name: 'capacity_tons', type: 'numeric', precision: 6, scale: 2, nullable: true })
  capacityTons!: string | null;

  @Column({
    name: 'deck_volume_cubic_meters',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  deckVolumeCubicMeters!: string | null;

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
