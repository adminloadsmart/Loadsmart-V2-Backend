import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TransporterEntity } from '../../../masters/transporter/entities/transporter.entity';
import { LoadPostingEntity } from './load-posting.entity';
import {
  MESSAGE_STATUSES,
  MessageStatus,
  RECIPIENT_TYPES,
  RecipientType,
} from '../utils/load-posting.types';

/** Who a posting went to. Loadsmart is always one row for market fleet; indent has exactly one
 *  transporter row; own fleet has none. */
@Entity({ schema: 'loads', name: 'load_recipients' })
@Index('load_recipients_tenant_posting_idx', ['tenantId', 'postingId'])
export class LoadRecipientEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'posting_id', type: 'uuid' })
  postingId!: string;

  @ManyToOne(() => LoadPostingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'posting_id' })
  posting!: LoadPostingEntity;

  @Column({ name: 'recipient_type', type: 'enum', enum: [...RECIPIENT_TYPES] })
  recipientType!: RecipientType;

  @Column({ name: 'transporter_id', type: 'uuid', nullable: true })
  transporterId!: string | null;

  @ManyToOne(() => TransporterEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity | null;

  @Column({ name: 'message_status', type: 'enum', enum: [...MESSAGE_STATUSES], default: 'pending' })
  messageStatus!: MessageStatus;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
