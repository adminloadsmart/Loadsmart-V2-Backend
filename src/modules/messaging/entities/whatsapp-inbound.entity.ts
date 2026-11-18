import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  InboundMessageType,
  InboundResolution,
  RoutingMethod,
  WhatsappProviderName,
} from '../messaging.types';

/**
 * One row per inbound WhatsApp message, with the evidence of how it was routed: which of our
 * messages it answered (context id → message_log), which rule found the load, and what happened.
 * The unique provider_message_id makes a re-delivered webhook a no-op.
 */
@Entity({ schema: 'notifications', name: 'whatsapp_inbound' })
@Index('whatsapp_inbound_provider_message_id_unique', ['provider', 'providerMessageId'], {
  unique: true,
})
@Index('whatsapp_inbound_sender_idx', ['fromPhone', 'receivedAt'])
@Index('whatsapp_inbound_load_idx', ['loadId'])
@Index('whatsapp_inbound_resolution_idx', ['resolution'])
@Index('whatsapp_inbound_picker_idx', ['pickerMessageLogId'])
export class WhatsappInboundEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  provider!: WhatsappProviderName;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255 })
  providerMessageId!: string;

  @Column({ name: 'from_phone', type: 'varchar', length: 32 })
  fromPhone!: string;

  /** Meta's business-scoped user id (from_user_id) — survives a missing phone (username users). */
  @Column({ name: 'from_user_id', type: 'varchar', length: 128, nullable: true })
  fromUserId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  type!: InboundMessageType;

  @Column({ name: 'provider_type', type: 'varchar', length: 32 })
  providerType!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ name: 'button_id', type: 'varchar', length: 256, nullable: true })
  buttonId!: string | null;

  @Column({ name: 'button_text', type: 'varchar', length: 100, nullable: true })
  buttonText!: string | null;

  @Column({ name: 'list_row_id', type: 'varchar', length: 200, nullable: true })
  listRowId!: string | null;

  @Column({ name: 'flow_response', type: 'jsonb', nullable: true })
  flowResponse!: Record<string, unknown> | null;

  /** { ref, mimeType, filename, storageFileId } — storageFileId once copied to our storage. */
  @Column({ type: 'jsonb', nullable: true })
  media!: Record<string, unknown> | null;

  /** The provider message id this message replied to (context id). */
  @Column({ name: 'context_message_id', type: 'varchar', length: 255, nullable: true })
  contextMessageId!: string | null;

  @Column({ name: 'matched_message_log_id', type: 'uuid', nullable: true })
  matchedMessageLogId!: string | null;

  @Column({ name: 'load_id', type: 'uuid', nullable: true })
  loadId!: string | null;

  @Column({ name: 'load_ref', type: 'varchar', length: 64, nullable: true })
  loadRef!: string | null;

  @Column({ name: 'recipient_ref_id', type: 'varchar', length: 64, nullable: true })
  recipientRefId!: string | null;

  /** Parsed rate / truck / driver / etc. — kept while waiting for a load pick. */
  @Column({ name: 'parsed_values', type: 'jsonb', nullable: true })
  parsedValues!: Record<string, unknown> | null;

  /** The "Load chunein" list we sent for this message (resolution awaiting_load_pick). */
  @Column({ name: 'picker_message_log_id', type: 'uuid', nullable: true })
  pickerMessageLogId!: string | null;

  @Column({ name: 'routing_method', type: 'varchar', length: 16, default: 'none' })
  routingMethod!: RoutingMethod;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  resolution!: InboundResolution;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @Column({ type: 'jsonb' })
  raw!: unknown;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
