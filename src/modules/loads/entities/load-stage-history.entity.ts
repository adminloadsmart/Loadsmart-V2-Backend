import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { LoadEntity } from './load.entity';
import { STAGE_ACTOR_TYPES, StageActorType } from '../core/stage-rules';
import { LoadStatus } from '../utils/loads.types';

/** How a stage move reached the system. */
export const STAGE_CHANNELS = [
  'web', // shipper web or app
  'driver_app',
  'console', // Loadsmart ops console
  'whatsapp',
  'call', // recorded by staff from a phone call
  'tracking', // a tracking-service event
  'system', // automatic: posting, closing once the last condition is met
] as const;
export type StageChannel = (typeof STAGE_CHANNELS)[number];

/**
 * One row per stage a load entered: when it entered and left, and the trigger, actor and channel
 * that put it there. Written only by LoadStageService (and LoadRepository.createMany for the first
 * stage), in the same transaction as the status — so the open row (exited_at null) is always the
 * load's current stage. Steps that keep the stage (an award at Bids received) are on the activity
 * timeline, not here. Analytics' time-at-stage reads this table.
 */
@Entity({ schema: 'loads', name: 'load_stage_history' })
@Index('load_stage_history_load_entered_idx', ['loadId', 'enteredAt'])
@Index('load_stage_history_one_open_per_load', ['loadId'], {
  unique: true,
  where: '"exited_at" IS NULL',
})
@Index('load_stage_history_tenant_stage_idx', ['tenantId', 'stage', 'enteredAt'])
export class LoadStageHistoryEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_stage_history_load' })
  load?: LoadEntity;
  @Column({ type: 'varchar', length: 32 }) stage!: LoadStatus;
  /** The load's route on entering the stage — null while unrouted. */
  @Column({ type: 'varchar', length: 32, nullable: true }) route!: string | null;
  /** stage-rules.ts StageTrigger; 'posted' / 'planned' for the first stage. */
  @Column({ type: 'varchar', length: 40 }) trigger!: string;
  @Column({ name: 'actor_type', type: 'enum', enum: [...STAGE_ACTOR_TYPES] })
  actorType!: StageActorType;
  /** A user, or the driver for driver_app moves; null for system and tracking moves. */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId!: string | null;
  @Column({ type: 'enum', enum: [...STAGE_CHANNELS] }) channel!: StageChannel;
  @Column({ name: 'entered_at', type: 'timestamptz' }) enteredAt!: Date;
  @Column({ name: 'exited_at', type: 'timestamptz', nullable: true }) exitedAt!: Date | null;
  @Column({ type: 'jsonb', nullable: true }) metadata!: Record<string, unknown> | null;
}
