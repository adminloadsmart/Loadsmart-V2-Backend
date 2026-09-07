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
import { NotificationEntity } from './notifications.entity';
import { NotificationChannelName, DeliveryStatus } from './notifications.types';

/**
 * One row per external channel requested on a NotificationEntity (email/sms/push — never
 * created for the implicit in-app channel, which is just the parent row's own existence).
 * Written by NotificationRepository.createWithDeliveries at creation (status 'pending') and
 * updated by the BullMQ worker via NotificationRepository.recordDeliveryResult as each channel's
 * job completes or exhausts its retries.
 */
@Entity({ schema: 'notifications', name: 'notification_deliveries' })
@Index('notification_deliveries_notification_channel_unique', ['notificationId', 'channel'], {
  unique: true,
})
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'notification_id', type: 'uuid' })
  notificationId!: string;

  @ManyToOne(() => NotificationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_id' })
  notification!: NotificationEntity;

  @Column({ type: 'enum', enum: ['email', 'sms', 'push'] })
  channel!: NotificationChannelName;

  // The email address / phone number / push token the caller supplied for this channel at
  // send() time — kept as an audit trail of exactly where the message was sent. This module
  // owns no contact/token registry of its own; the caller passes destinations directly.
  @Column({ type: 'varchar', length: 512 })
  destination!: string;

  @Column({ type: 'enum', enum: ['pending', 'sent', 'failed'], default: 'pending' })
  status!: DeliveryStatus;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
