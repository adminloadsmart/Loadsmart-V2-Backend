import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoadEntity } from '../entities/load.entity';

export const ELR_ACTIONS = ['issued', 'edited', 'cancelled'] as const;
export type ElrAction = (typeof ELR_ACTIONS)[number];

/** "Edit with a reason (carrier replaced the driver, wrong details, relief driver,
 *  transhipment)". */
export const ELR_EDIT_REASONS = [
  'driver_replaced',
  'wrong_details',
  'relief_driver',
  'transhipment',
] as const;
export type ElrEditReason = (typeof ELR_EDIT_REASONS)[number];

/** The e-LR's change history: issued, each edit with its reason and what changed, cancelled. The
 *  number and vehicle never change; a cancelled number is never reused. */
@Entity({ schema: 'loads', name: 'load_elr_revisions' })
@Index('load_elr_revisions_load_idx', ['loadId', 'revision'])
export class LoadElrRevisionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_elr_revisions_load' })
  load?: LoadEntity;
  @Column({ name: 'elr_number', type: 'varchar', length: 50 }) elrNumber!: string;
  /** 1 for the issue, then one per edit or cancellation. */
  @Column({ type: 'integer' }) revision!: number;
  @Column({ type: 'enum', enum: [...ELR_ACTIONS] }) action!: ElrAction;
  @Column({ type: 'varchar', length: 40, nullable: true }) reason!: string | null;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  /** The fields this revision set. */
  @Column({ type: 'jsonb', nullable: true }) changes!: Record<string, unknown> | null;
  /** The PDF this revision produced (none for a cancellation). */
  @Column({ name: 'file_key', type: 'text', nullable: true }) fileKey!: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
