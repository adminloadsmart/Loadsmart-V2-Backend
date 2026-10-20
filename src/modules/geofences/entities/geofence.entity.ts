import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import {
  GEOFENCE_SHAPES,
  GEOFENCE_TYPES,
  GeofenceShape,
  GeofenceType,
  GeoPoint,
} from '../utils/geofence.types';
import { GeofenceVehicleEntity } from './geofence-vehicle.entity';
import { GeofenceRecipientEntity } from './geofence-recipient.entity';

/**
 * A named place (Tracking → Geofences → Add geofence): a circle (pin + radius) or a drawn polygon,
 * with alert rules and the trucks/people they apply to. A loading_point / unloading_point geofence
 * can be linked to the master loading point or customer delivery point it stands for — that link
 * is what lets a vehicle entering it advance the right load (the tracking service matches it to the
 * trip's pickup/drop point and sends trip.arrived_at_pickup / trip.arrived_at_drop).
 * Soft-deleted only (FMS-MAS-R002).
 */
@Entity({ schema: 'tracking', name: 'geofences' })
@Index('geofences_tenant_id_idx', ['tenantId'])
@Index('geofences_tenant_type_idx', ['tenantId', 'type'])
export class GeofenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'enum', enum: [...GEOFENCE_TYPES] })
  type!: GeofenceType;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  /** The pin (search result / map click). Numeric columns come back as strings. */
  @Column({ type: 'numeric', precision: 10, scale: 6 })
  latitude!: string;

  @Column({ type: 'numeric', precision: 10, scale: 6 })
  longitude!: string;

  @Column({ type: 'enum', enum: [...GEOFENCE_SHAPES], default: 'circle' })
  shape!: GeofenceShape;

  /** Circle only. */
  @Column({ name: 'radius_m', type: 'integer', nullable: true })
  radiusM!: number | null;

  /** Polygon only — vertices in drawing order. */
  @Column({ type: 'jsonb', nullable: true })
  polygon!: GeoPoint[] | null;

  @Column({ name: 'alert_on_enter', type: 'boolean', default: true })
  alertOnEnter!: boolean;

  @Column({ name: 'alert_on_exit', type: 'boolean', default: true })
  alertOnExit!: boolean;

  @Column({ name: 'dwell_alert_minutes', type: 'integer', nullable: true })
  dwellAlertMinutes!: number | null;

  @Column({ name: 'engine_on_alert_minutes', type: 'integer', nullable: true })
  engineOnAlertMinutes!: number | null;

  @Column({ name: 'applies_to_all_vehicles', type: 'boolean', default: true })
  appliesToAllVehicles!: boolean;

  @Column({ name: 'loading_point_id', type: 'uuid', nullable: true })
  loadingPointId!: string | null;

  @Column({ name: 'customer_delivery_point_id', type: 'uuid', nullable: true })
  customerDeliveryPointId!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => GeofenceVehicleEntity, (v) => v.geofence)
  vehicles!: GeofenceVehicleEntity[];

  @OneToMany(() => GeofenceRecipientEntity, (r) => r.geofence)
  recipients!: GeofenceRecipientEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
