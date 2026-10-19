import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LOADING_POINT_STATUSES, LoadingPointStatus } from '../loading-point.types';
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  LOCATION_SOURCES,
  LocationSource,
} from '../../../../shared/constants/location-source';

@Entity({ schema: 'masters', name: 'loading_points' })
@Index('loading_points_tenant_id_idx', ['tenantId'])
@Index('loading_points_tenant_status_idx', ['tenantId', 'status'])
@Index('loading_points_tenant_city_idx', ['tenantId', 'city'])
export class LoadingPointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  // Nullable since the settings redesign: the Add Loading Point form only has "Find on map" +
  // city/state/PIN — the Places formatted address lands here when the client sends it.
  @Column({ name: 'address_line_1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line_2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  landmark!: string | null;

  @Column({ name: 'area_locality', type: 'varchar', length: 255, nullable: true })
  areaLocality!: string | null;

  @Column({ type: 'varchar', length: 100 })
  city!: string;

  @Column({ type: 'varchar', length: 100 })
  state!: string;

  @Column({ name: 'pin_code', type: 'varchar', length: 10 })
  pinCode!: string;

  @Column({ name: 'latitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  latitude!: string | null;

  @Column({ name: 'longitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  longitude!: string | null;

  @Column({ name: 'contact_person_name', type: 'varchar', length: 150, nullable: true })
  contactPersonName!: string | null;

  @Column({ name: 'contact_person_number', type: 'varchar', length: 20, nullable: true })
  contactPersonNumber!: string | null;

  @Column({ name: 'contact_person_email', type: 'varchar', length: 255, nullable: true })
  contactPersonEmail!: string | null;

  @Column({ name: 'geofence_radius_m', type: 'integer', default: DEFAULT_GEOFENCE_RADIUS_M })
  geofenceRadiusM!: number;

  /** Gate operating window, 'HH:MM:SS' as Postgres returns `time` ('24:00:00' allowed). */
  @Column({ name: 'gate_opens_at', type: 'time', nullable: true })
  gateOpensAt!: string | null;

  @Column({ name: 'gate_closes_at', type: 'time', nullable: true })
  gateClosesAt!: string | null;

  @Column({ name: 'google_place_id', type: 'varchar', length: 255, nullable: true })
  googlePlaceId!: string | null;

  @Column({ name: 'location_source', type: 'enum', enum: [...LOCATION_SOURCES], default: 'manual' })
  locationSource!: LocationSource;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'enum', enum: [...LOADING_POINT_STATUSES], default: 'pending' })
  status!: LoadingPointStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;

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
