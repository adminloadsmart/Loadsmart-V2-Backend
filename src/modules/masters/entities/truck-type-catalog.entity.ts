import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Global truck-type master (PRD §5.7 — "configurable from the Admin Panel"), not scoped to any
 * tenant. Org admins browse this list in the "Add truck type" modal and pick which ones to add to
 * their own TruckTypeEntity rows — this table itself is only ever seeded/edited platform-side.
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
