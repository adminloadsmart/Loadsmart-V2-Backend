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
import { CallOutcome, CallParty, CallTeam } from '../utils/loads.types';

/** One person spoken to on a call: their role on the load, and the name / number used. */
export interface CallPartyRef {
  role: CallParty;
  name?: string | null;
  phone?: string | null;
}

/** Log a call (spec p.36) — one call about one load. */
@Entity({ schema: 'loads', name: 'load_calls' })
@Index('load_calls_load_idx', ['loadId', 'createdAt'])
@Index('load_calls_open_reminder_idx', ['calledByUserId', 'reminderAt'], {
  where: '"reminder_at" IS NOT NULL AND "reminder_done_at" IS NULL',
})
export class LoadCallEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_calls_load' })
  load?: LoadEntity;

  @Column({ name: 'called_by_user_id', type: 'uuid' })
  calledByUserId!: string;

  @Column({ type: 'varchar', length: 32 })
  team!: CallTeam;

  @Column({ type: 'jsonb' })
  parties!: CallPartyRef[];

  /** What was discussed, in the team member's words. */
  @Column({ type: 'text' })
  notes!: string;

  @Column({ type: 'varchar', length: 16 })
  outcome!: CallOutcome;

  /** The price given, when the outcome is `price`. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price!: string | null;

  @Column({ name: 'reminder_at', type: 'timestamptz', nullable: true })
  reminderAt!: Date | null;

  @Column({ name: 'reminder_done_at', type: 'timestamptz', nullable: true })
  reminderDoneAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
