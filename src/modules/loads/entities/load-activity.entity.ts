import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LoadEntity } from './load.entity';
import { LOAD_ACTIVITY_ACTIONS, LoadActivityAction } from '../utils/loads.types';

/**
 * A pure append-only per-load chronological log — powers the Load Detail screen's Activity
 * The shared audit module (modules/audit) has no per-resource
 * read path (no `resourceId` column, no findByResource), so this is a dedicated table scoped to
 * `loadId` instead of widening that shared, platform-wide sink. Every load-mutating service method
 * also still calls the shared AuditService.log(...), matching the convention every other
 * write-heavy module follows — this table is the timeline source, audit_logs stays the
 * platform-wide record. No `updatedAt` — rows are never modified once written.
 */
@Entity({ schema: 'loads', name: 'load_activities' })
@Index('load_activities_tenant_id_idx', ['tenantId'])
@Index('load_activities_load_created_idx', ['loadId', 'createdAt'])
export class LoadActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'enum', enum: [...LOAD_ACTIVITY_ACTIONS] })
  action!: LoadActivityAction;

  @Column({ name: 'from_value', type: 'varchar', length: 100, nullable: true })
  fromValue!: string | null;

  @Column({ name: 'to_value', type: 'varchar', length: 100, nullable: true })
  toValue!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
