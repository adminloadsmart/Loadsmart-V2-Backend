import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn, Index } from 'typeorm';

/** Last known inside/outside state of a vehicle per geofence — what makes enter/exit detection
 *  idempotent (only a change of state is an event) and lets stale, out-of-order pings be ignored. */
@Entity({ schema: 'tracking', name: 'vehicle_geofence_states' })
@Index('vehicle_geofence_states_vehicle_geofence_unique', ['vehicleId', 'geofenceId'], {
  unique: true,
})
@Index('vehicle_geofence_states_tenant_idx', ['tenantId'])
export class VehicleGeofenceStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @Column({ name: 'geofence_id', type: 'uuid' })
  geofenceId!: string;

  @Column({ type: 'boolean' })
  inside!: boolean;

  @Column({ name: 'entered_at', type: 'timestamptz', nullable: true })
  enteredAt!: Date | null;

  @Column({ name: 'last_ping_at', type: 'timestamptz' })
  lastPingAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
