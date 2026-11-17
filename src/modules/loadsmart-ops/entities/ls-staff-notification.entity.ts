import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** An in-app notification for a Loadsmart team member (platform staff, no tenant). The shared
 *  notifications module is tenant-scoped end to end (preferences, quiet hours, the inbox route), so
 *  the ops console keeps its own small inbox: GET /loadsmart-ops/notifications. */
@Entity({ schema: 'loads', name: 'ls_staff_notifications' })
@Index('ls_staff_notifications_recipient_idx', ['recipientUserId', 'readAt', 'createdAt'])
export class LsStaffNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  /** e.g. `partner_advance.raised` — the screen picks its icon and link from this. */
  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'load_id', type: 'uuid', nullable: true })
  loadId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
