import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TRUCK_BODY_TYPES, TruckBodyType } from '../../truck-type/truck-type.types';

/**
 * Global truck-type master (PRD §5.7 — "configurable from the Admin Panel"), not scoped to any
 * tenant. Org admins browse this list in the "Add truck type" modal and pick which ones to add to
 * their own TruckTypeEntity rows — this table itself is only ever seeded/edited platform-side.
 *
 * The structured picker fields mirror TruckTypeEntity's (Plan Dispatch v2.0 §6.6): nullable since
 * older catalog rows were seeded name-only, before this table carried body/wheel/capacity data.
 */
@Entity({ schema: 'masters', name: 'truck_type_catalog' })
@Index('truck_type_catalog_name_active_unique', ['name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class TruckTypeCatalogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'body_type', type: 'enum', enum: [...TRUCK_BODY_TYPES], nullable: true })
  bodyType!: TruckBodyType | null;

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
