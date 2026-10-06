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
 * One row per (tenant, notification type) — org-wide, not per-user: "Choose how your team gets
 * alerted" on the settings screen, editable only by org_admin (see notification-preferences.
 * service.ts's assertOrgAdmin), applies identically to every user in that org. A missing row
 * means every channel is off (opt-in default; see notify-by-type.ts). `tenantId` is deliberately
 * opaque, not FK'd to organizations — same "not validated by this module" precedent as
 * NotificationEntity.tenantId.
 *
 * In-app has no column here: it's unconditional and was never itself a NotificationChannelName
 * (see notifications.types.ts) — the settings screen shows it locked on, nothing to store.
 */
@Entity({ schema: 'notifications', name: 'notification_preferences' })
@Index('notification_preferences_tenant_type_unique', ['tenantId', 'notificationTypeId'], {
  unique: true,
})
export class NotificationPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'notification_type_id', type: 'uuid' })
  notificationTypeId!: string;

  @ManyToOne(() => NotificationTypeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_type_id' })
  notificationType!: NotificationTypeEntity;

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
