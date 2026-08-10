import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import {
  OrganizationEntity,
  OrganizationJourneyStage,
  ORGANIZATION_JOURNEY_STAGES,
} from './organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';

// Append-only trail of every journey stage an organization has passed through — one row per
// transition, written by OrganizationJourneyStageService.recordTransition alongside the current
// value it also writes to OrganizationEntity.journeyStage. Rows are never updated/deleted, only
// inserted, so unlike organization_documents there's no soft-delete/updatedAt here.
@Entity({ schema: 'auth', name: 'organization_journey_stage_history' })
@Index('organization_journey_stage_history_org_id_idx', ['organizationId'])
export class OrganizationJourneyStageHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'enum', enum: ORGANIZATION_JOURNEY_STAGES })
  stage!: OrganizationJourneyStage;

  // Who caused this transition — the org admin themselves on submit, the acting staff member on
  // assign/approve/reject. Nullable + SET NULL since the trail entry should outlive the actor's
  // user row.
  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by' })
  changedByUser!: UserEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
