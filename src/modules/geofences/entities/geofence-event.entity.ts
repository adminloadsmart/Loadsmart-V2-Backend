import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';
import { GEOFENCE_EVENT_TYPES, GeofenceEventType } from '../utils/geofence.types';

/** Append-only log of enter/exit transitions. `loadId` is the vehicle's live load at that moment
 *  (if any) — it makes a status change traceable back to the ping that caused it. */
@Entity({ schema: 'tracking', name: 'geofence_events' })
@Index('geofence_events_tenant_geofence_idx', ['tenantId', 'geofenceId', 'occurredAt'])
@Index('geofence_events_tenant_vehicle_idx', ['tenantId', 'vehicleId', 'occurredAt'])
export class GeofenceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'geofence_id', type: 'uuid' })
  geofenceId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @Column({ name: 'load_id', type: 'uuid', nullable: true })
  loadId!: string | null;

  @Column({ type: 'enum', enum: [...GEOFENCE_EVENT_TYPES] })
  event!: GeofenceEventType;

  @Column({ type: 'numeric', precision: 10, scale: 6 })
  latitude!: string;

  @Column({ type: 'numeric', precision: 10, scale: 6 })
  longitude!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
