import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One saved version of Super Admin → Settings. Rows are never updated: a save inserts the next
 *  version, and each load keeps the id of the version it was posted under. */
@Entity({ schema: 'loads', name: 'settings_versions' })
@Index('settings_versions_version_unique', ['version'], { unique: true })
export class SettingsVersionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'integer' }) version!: number;
  /** Every setting's value (settings.types.ts → SettingsValues). */
  @Column({ type: 'jsonb' }) settings!: Record<string, unknown>;
  /** Why it was changed, as Super Admin wrote it. */
  @Column({ type: 'text', nullable: true }) note!: string | null;
  /** Null for version 1, created by the migration. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
