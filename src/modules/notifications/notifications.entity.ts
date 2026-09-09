import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannelName, NotificationStatus } from './notifications.types';

/**
 * The permanent record of every notification sent — not just a transient queue payload. Created
 * by NotificationsService.send() (called in-process by other modules; there is no HTTP endpoint
 * to create one) and read back via GET /notifications and GET /notifications/:notificationId so
 * the recipient can see both a list and the full detail of anything sent to them.
 *
 * `channels` lists which external channels (beyond this row's own in-app existence) were
 * requested — one NotificationDeliveryEntity row per channel tracks that channel's actual
 * send outcome; see notification-delivery.entity.ts.
 */
@Entity({ schema: 'notifications', name: 'notifications' })
@Index('notifications_tenant_recipient_idx', ['tenantId', 'recipientUserId'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  // Opaque owner id for "my notifications" listing — not validated against auth.users by this
  // module (no AuthService dependency here; see notifications.service.ts).
  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  // Free-form, producer-defined key (e.g. 'maintenance.service_due') — no enum, since producers
  // outside this module define their own notification types.
  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  // Requested external channels at creation — [] means in-app only.
  @Column({ type: 'jsonb' })
  channels!: NotificationChannelName[];

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: ['pending', 'processing', 'sent', 'partially_failed', 'failed'],
    default: 'pending',
  })
  status!: NotificationStatus;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
