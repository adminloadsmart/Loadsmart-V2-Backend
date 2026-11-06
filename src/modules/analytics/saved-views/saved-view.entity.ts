import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A named set of analytics filters a user saved (Shipper Analytics §6 "saved as a named view"). */
@Entity({ schema: 'analytics', name: 'saved_views' })
@Index('saved_views_user_module_name_uq', ['tenantId', 'userId', 'module', 'name'], {
  unique: true,
})
export class SavedViewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** The analytics screen the view belongs to, e.g. "shipper". */
  @Column({ type: 'varchar', length: 40 })
  module!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** The filter bar's query, as sent to the analytics endpoints. */
  @Column({ type: 'jsonb' })
  filters!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
