import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NotificationTypeEntity } from './notification-type.entity';

/**
 * One row per (tenant, user, notification type) — a user's own choice of mediums for that type,
 * set from Settings → Notifications. It overrides the organisation's row in
 * notification_preferences (the org_admin's setting), which in turn overrides the type's
 * defaultChannels; see utils/channel-preferences.ts. A missing row means "not customised yet".
 * Only the mediums the type supports (the catalog's `channels`, plus in-app for types shown in
 * the app) can ever be stored as enabled.
 */
@Entity({ schema: 'notifications', name: 'user_notification_preferences' })
@Index(
  'user_notification_preferences_tenant_user_type_unique',
  ['tenantId', 'userId', 'notificationTypeId'],
  { unique: true },
)
export class UserNotificationPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'notification_type_id', type: 'uuid' })
  notificationTypeId!: string;

  @ManyToOne(() => NotificationTypeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_type_id' })
  notificationType!: NotificationTypeEntity;

  @Column({ name: 'in_app_enabled', default: true })
  inAppEnabled!: boolean;

  @Column({ name: 'email_enabled', default: false })
  emailEnabled!: boolean;

  @Column({ name: 'sms_enabled', default: false })
  smsEnabled!: boolean;

  @Column({ name: 'push_enabled', default: false })
  pushEnabled!: boolean;

  @Column({ name: 'whatsapp_enabled', default: false })
  whatsappEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
