import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { REQUIREMENT_SEND_STATUSES, RequirementSendStatus } from '../loadsmart.types';

/** One broker Placement sent a load's requirement to ("Send requirement"): whether the WhatsApp
 *  offer went, and — from MSG91's delivery reports — when it was delivered and read. One row per
 *  broker per load; sending again skips a broker already sent to. */
@Entity({ schema: 'loads', name: 'ls_requirement_recipients' })
@Unique('ls_requirement_recipients_sourcing_partner_uq', ['sourcingId', 'partnerId'])
export class LsRequirementRecipientEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId!: string;

  @Column({ type: 'enum', enum: [...REQUIREMENT_SEND_STATUSES] })
  status!: RequirementSendStatus;

  /** The WhatsApp offer's message_log row (null when nothing went). */
  @Column({ name: 'message_log_id', type: 'uuid', nullable: true })
  messageLogId!: string | null;

  @Column({ name: 'fail_reason', type: 'varchar', length: 300, nullable: true })
  failReason!: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'sent_by', type: 'uuid' })
  sentBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
