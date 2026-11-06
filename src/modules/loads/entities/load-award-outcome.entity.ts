import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** What happened after a load was awarded to a transporter (Shipper Analytics §5 "Award record"). */
export const AWARD_OUTCOMES = ['won', 'accepted', 'refused', 'no_truck'] as const;
export type AwardOutcome = (typeof AWARD_OUTCOMES)[number];

/**
 * One row per event: `won` when a transporter is awarded the load, then `accepted` when it puts a
 * truck on it, or `refused` / `no_truck` when it hands the load back. Tender acceptance (§9) is
 * accepted ÷ won; the "Tender accepted" stage (§10) counts the refusals and no-trucks.
 */
@Entity({ schema: 'loads', name: 'load_award_outcomes' })
@Index('load_award_outcomes_tenant_load_idx', ['tenantId', 'loadId'])
@Index('load_award_outcomes_tenant_transporter_idx', ['tenantId', 'transporterId'])
export class LoadAwardOutcomeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'transporter_id', type: 'uuid' })
  transporterId!: string;

  @Column({ type: 'enum', enum: [...AWARD_OUTCOMES] })
  outcome!: AwardOutcome;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
