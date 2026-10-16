import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * One row per tenant — the organisation's quiet hours ("don't ping my team overnight"), editable
 * only by org_admin, applied org-wide like notification_preferences. Times are 'HH:MM' in India
 * time; a window may wrap midnight (22:00 → 07:00). No row = quiet hours off. See quiet-hours.ts
 * for how a dispatch uses it.
 */
@Entity({ schema: 'notifications', name: 'notification_quiet_hours' })
export class NotificationQuietHoursEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ default: false })
  enabled!: boolean;

  @Column({ name: 'start_time', type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ name: 'end_time', type: 'varchar', length: 5 })
  endTime!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
