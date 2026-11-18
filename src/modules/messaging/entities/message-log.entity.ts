import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  MessageLogStatus,
  MessageRecipientKind,
  OutboundMessageKind,
  WhatsappProviderName,
  MessageIntent,
} from '../messaging.types';

/**
 * One row per outbound message to a broker / transporter / driver / receiver (task 3 + 4).
 * `provider_message_id` (the WAMID) is how every reply and status finds its way back to the
 * recipient and load: replies quote it (context id), statuses carry it.
 */
@Entity({ schema: 'notifications', name: 'message_log' })
@Index('message_log_provider_message_id_unique', ['providerMessageId'], {
  unique: true,
  where: '"provider_message_id" IS NOT NULL',
})
@Index('message_log_load_idx', ['loadId'])
@Index('message_log_recipient_idx', ['recipientRefId', 'createdAt'])
@Index('message_log_provider_request_idx', ['providerRequestId'])
export class MessageLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'load_id', type: 'uuid', nullable: true })
  loadId!: string | null;

  /** Human load ref used in our ids and message text (e.g. LS-2004). */
  @Column({ name: 'load_ref', type: 'varchar', length: 64, nullable: true })
  loadRef!: string | null;

  @Column({ name: 'recipient_kind', type: 'varchar', length: 32 })
  recipientKind!: MessageRecipientKind;

  /** load_recipients.id / ls partner id / driver id — whatever row the reply must update. */
  @Column({ name: 'recipient_ref_id', type: 'varchar', length: 64, nullable: true })
  recipientRefId!: string | null;

  @Column({ name: 'recipient_name', type: 'varchar', length: 200, nullable: true })
  recipientName!: string | null;

  /** Phone (digits with country code) or email the message went to. */
  @Column({ type: 'varchar', length: 200 })
  address!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: 'whatsapp' | 'sms' | 'email' | 'push' | 'in_app';

  @Column({ type: 'varchar', length: 16, nullable: true })
  provider!: WhatsappProviderName | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  kind!: OutboundMessageKind | null;

  @Column({ name: 'template_key', type: 'varchar', length: 100, nullable: true })
  templateKey!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  variables!: Record<string, unknown> | null;

  @Column({ name: 'rendered_text', type: 'text', nullable: true })
  renderedText!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  intent!: MessageIntent | null;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: MessageLogStatus;

  @Column({ name: 'suppressed_reason', type: 'varchar', length: 100, nullable: true })
  suppressedReason!: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId!: string | null;

  /** Set by providers that return only a request id on send (MSG91); WAMID is backfilled. */
  @Column({ name: 'provider_request_id', type: 'varchar', length: 255, nullable: true })
  providerRequestId!: string | null;

  /** The inbound message this one answers (we quote it on WhatsApp). */
  @Column({ name: 'reply_to_inbound_id', type: 'uuid', nullable: true })
  replyToInboundId!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  error!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
