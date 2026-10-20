import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { GeofenceEntity } from './geofence.entity';

/** "Applies to → Choose trucks": one row per vehicle a geofence is limited to. Unused when the
 *  geofence applies to all vehicles. */
@Entity({ schema: 'tracking', name: 'geofence_vehicles' })
@Index('geofence_vehicles_geofence_vehicle_unique', ['geofenceId', 'vehicleId'], { unique: true })
@Index('geofence_vehicles_vehicle_idx', ['vehicleId'])
export class GeofenceVehicleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'geofence_id', type: 'uuid' })
  geofenceId!: string;

  @ManyToOne(() => GeofenceEntity, (geofence) => geofence.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'geofence_id' })
  geofence!: GeofenceEntity;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;
}
