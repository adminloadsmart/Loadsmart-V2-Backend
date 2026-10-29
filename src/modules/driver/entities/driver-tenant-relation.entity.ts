import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { DriverEntity } from './driver.entity';
import { DriverOperationalStatusEntity } from './driver-operational-status.entity';
import { DriverTripMetricsEntity } from './driver-trip-metrics.entity';
import { FleetDriverLinkEntity } from '../../masters/fleet-driver-link/entities/fleet-driver-link.entity';
import {
  DRIVER_INVITE_DELIVERY_STATUSES,
  DriverInviteChannel,
  DriverInviteDeliveryStatus,
  DriverInviteSendStep,
  DRIVER_TENANT_RELATION_INITIATORS,
  DRIVER_TENANT_RELATION_STATUSES,
  DriverTenantRelationInitiator,
  DriverTenantRelationStatus,
} from '../drivers.types';

/**
 * One entry of an invite's permanent log (invite_timeline), oldest first. Entries are only ever
 * appended — a Resend or a fresh invite on the same row adds to the log and never clears it. `at`
 * is an ISO timestamp; `by` is the staff user's id. `expired` is written when an expired invite is
 * resent; until then the drawer derives it from invite_expires_at. `whatsapp_read` is the driver
 * reading a send's WhatsApp message — logged once per send (not written while read tracking is
 * off). `link_opened` is the driver tapping the tracked app link in it — logged on every tap, with
 * the device; the invitation's `openedAt` and `opened` step. `viewed` (an in-app notification
 * opened) is no longer written; it stays here only so older rows still type-check, and the
 * invitation detail drops it.
 */
export type DriverInviteEvent =
  | { step: DriverInviteSendStep; at: string; by: string | null }
  | { step: 'whatsapp_read'; at: string }
  | { step: 'link_opened'; at: string; device: string | null }
  | { step: 'viewed'; at: string; device: string | null; notificationId?: string }
  | { step: 'expired'; at: string }
  | { step: 'declined'; at: string; reason: string | null }
  | { step: 'cancelled'; at: string; by: string | null }
  | { step: 'accepted'; at: string }
  | { step: 'delivery_failed'; at: string; channel: DriverInviteChannel };

/** A send entry of the invite's timeline. */
export type DriverInviteSendEvent = Extract<DriverInviteEvent, { step: DriverInviteSendStep }>;

// The tenant-scoped employment/membership record a global DriverEntity used to be. Everything
// employer-specific (salary, dateOfJoining) and the mutual-approval workflow (staff onboarding,
// fleet-owner invite, driver join-request — see DRIVER_TENANT_RELATION_STATUSES) lives here so one
// driver profile can be linked, independently, to many tenants.
@Entity({ schema: 'masters', name: 'driver_tenant_relations' })
@Index('driver_tenant_relations_tenant_id_idx', ['tenantId'])
@Index('driver_tenant_relations_driver_id_idx', ['driverId'])
// One live-or-pending relation per tenant per driver; unlimited relations across different tenants.
@Index('driver_tenant_relations_tenant_driver_live_unique', ['tenantId', 'driverId'], {
  unique: true,
  where:
    "\"deleted_at\" IS NULL AND \"status\" IN ('pending_staff_review', 'pending_driver_review', 'active')",
})
export class DriverTenantRelationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.tenantRelations, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({
    type: 'enum',
    enum: [...DRIVER_TENANT_RELATION_STATUSES],
    default: 'active',
  })
  status!: DriverTenantRelationStatus;

  @Column({ name: 'initiated_by', type: 'enum', enum: [...DRIVER_TENANT_RELATION_INITIATORS] })
  initiatedBy!: DriverTenantRelationInitiator;

  // auth.users id when initiatedBy is 'staff' or 'fleet_owner'; null when 'driver' (driverId
  // already identifies the actor).
  @Column({ name: 'initiated_by_user_id', type: 'uuid', nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'driver_responded_at', type: 'timestamptz', nullable: true })
  driverRespondedAt!: Date | null;

  @Column({ name: 'fleet_owner_responded_at', type: 'timestamptz', nullable: true })
  fleetOwnerRespondedAt!: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  // When the tenant's invite last reached the driver (first send or Resend) — "Sent On" on the
  // Invitations Sent tab. Null for driver-initiated requests and invites not yet sent.
  @Column({ name: 'invite_sent_at', type: 'timestamptz', nullable: true })
  inviteSentAt!: Date | null;

  // inviteSentAt + DRIVER_INVITE_TTL_DAYS; past it a pending invite reads as Expired and can no
  // longer be accepted.
  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt!: Date | null;

  // Sequential "Req ID" (formatted INV-00042) — DB default from masters.driver_invite_number_seq,
  // stable across Resends. bigint, so TypeORM hands it back as a string.
  @Column({ name: 'invite_number', type: 'bigint', insert: false, update: false })
  inviteNumber!: string;

  // Staff user behind the latest send ("Dispatched by …") — the inviting org_admin, the approving
  // org_admin for a dispatch-added driver, or whoever pressed Resend last.
  @Column({ name: 'invite_sent_by', type: 'uuid', nullable: true })
  inviteSentBy!: string | null;

  // Permanent, append-only log of this invite — sends, resends, views, expiry, the driver's
  // answer, cancel, failed deliveries (see DriverInviteEvent). The send/view/channel columns above
  // only hold the latest send; this keeps every one. Written by the repository's appendToTimeline.
  @Column({
    name: 'invite_timeline',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  inviteTimeline!: DriverInviteEvent[];

  // Driver opened the latest invite notification on their device (see
  // DriverPortalService.markMyNotificationRead); cleared on every Resend.
  @Column({ name: 'invite_viewed_at', type: 'timestamptz', nullable: true })
  inviteViewedAt!: Date | null;

  @Column({ name: 'invite_viewed_device', type: 'varchar', length: 255, nullable: true })
  inviteViewedDevice!: string | null;

  // Per-channel result of the latest send. SMS/WhatsApp stay `pending` (recorded, not sent) until
  // the notification-branch sending lands; push reflects the real FCM push.
  @Column({
    name: 'sms_delivery_status',
    type: 'enum',
    enum: [...DRIVER_INVITE_DELIVERY_STATUSES],
    enumName: 'driver_tenant_relations_invite_delivery_status_enum',
    nullable: true,
  })
  smsDeliveryStatus!: DriverInviteDeliveryStatus | null;

  @Column({ name: 'sms_delivery_status_at', type: 'timestamptz', nullable: true })
  smsDeliveryStatusAt!: Date | null;

  @Column({
    name: 'whatsapp_delivery_status',
    type: 'enum',
    enum: [...DRIVER_INVITE_DELIVERY_STATUSES],
    enumName: 'driver_tenant_relations_invite_delivery_status_enum',
    nullable: true,
  })
  whatsappDeliveryStatus!: DriverInviteDeliveryStatus | null;

  @Column({ name: 'whatsapp_delivery_status_at', type: 'timestamptz', nullable: true })
  whatsappDeliveryStatusAt!: Date | null;

  // MSG91's request id for the latest WhatsApp send — matches its delivery-report webhook to this
  // invite. Null until a send is accepted; overwritten on every Resend.
  @Index('driver_tenant_relations_whatsapp_request_id_idx')
  @Column({ name: 'whatsapp_request_id', type: 'varchar', length: 100, nullable: true })
  whatsappRequestId!: string | null;

  @Column({
    name: 'push_delivery_status',
    type: 'enum',
    enum: [...DRIVER_INVITE_DELIVERY_STATUSES],
    enumName: 'driver_tenant_relations_invite_delivery_status_enum',
    nullable: true,
  })
  pushDeliveryStatus!: DriverInviteDeliveryStatus | null;

  @Column({ name: 'push_delivery_status_at', type: 'timestamptz', nullable: true })
  pushDeliveryStatusAt!: Date | null;

  // This fleet's own free-text note about the driver — per relation, so other fleets never see it.
  @Column({ name: 'note', type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  // Who last wrote `note` and when — the note card's "Mohit, 1 Aug 2020". Null for notes saved
  // before this was recorded.
  @Column({ name: 'note_updated_by', type: 'uuid', nullable: true })
  noteUpdatedBy!: string | null;

  @Column({ name: 'note_updated_at', type: 'timestamptz', nullable: true })
  noteUpdatedAt!: Date | null;

  // Set by reject, cleared by approve — mirrors the old DriverEntity.rejectionReason.
  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;

  // When this tenant rejected the link (PATCH /drivers/:driverId/reject) and which staff user did
  // it — Recently Rejected lists, and restore allows, DRIVER_JOIN_REQUEST_RESTORE_DAYS from here.
  // Cleared by restore.
  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'rejected_by', type: 'uuid', nullable: true })
  rejectedBy!: string | null;

  @OneToOne(() => DriverOperationalStatusEntity, (status) => status.driverTenantRelation)
  operationalStatus!: DriverOperationalStatusEntity;

  @OneToMany(() => DriverTripMetricsEntity, (metric) => metric.driverTenantRelation)
  tripMetrics!: DriverTripMetricsEntity[];

  @OneToMany(() => FleetDriverLinkEntity, (link) => link.driverTenantRelation)
  vehicleLinks!: FleetDriverLinkEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
