import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationChannelName } from '../notifications.types';

/**
 * App-wide catalog of notification types (no tenantId — same "fixed, seeded catalog" shape as
 * auth.roles), seeded from the in-code catalog (see catalog/notification-catalog.ts and
 * src/db/seed-notification-types.ts) rather than hand-maintained here. `key` matches the string
 * key producers already pass to notify-by-type.ts (e.g. 'vehicle.compliance_expiring_soon') — the
 * code catalog stays the source of truth for recipients/content; this table only exists so the
 * settings screen (notification-preferences.*) has something to query.
 */
@Entity({ schema: 'notifications', name: 'notification_types' })
export class NotificationTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  key!: string;

  @Column()
  label!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Every channel this type could ever use — currently all four for every type (nothing is
  // grayed out on the settings screen); notification-preferences.service.ts still clamps a save
  // request against this, so a future type CAN restrict itself again without a schema change.
  @Column({ type: 'jsonb' })
  channels!: NotificationChannelName[];

  // Which of `channels` are ON before an org_admin has ever saved a preference for this type —
  // matches the settings-screen mockup's shown toggle states. "Reset to Default"
  // (notification-preferences.service.ts) puts a tenant back to exactly this.
  @Column({ name: 'default_channels', type: 'jsonb' })
  defaultChannels!: NotificationChannelName[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
