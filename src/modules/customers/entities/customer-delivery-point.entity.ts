import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CustomerEntity } from './customer.entity';
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  LOCATION_SOURCES,
  LocationSource,
} from '../../../shared/constants/location-source';

@Entity({ schema: 'customers', name: 'customer_delivery_points' })
@Index('customer_delivery_points_tenant_customer_idx', ['tenantId', 'customerId'])
export class CustomerDeliveryPointEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 255 }) location!: string;
  @Column({ name: 'address_line_1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;
  @Column({ name: 'address_line_2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) landmark!: string | null;
  @Column({ name: 'area_locality', type: 'varchar', length: 255, nullable: true })
  areaLocality!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) state!: string | null;
  @Column({ name: 'pin_code', type: 'varchar', length: 10, nullable: true })
  pinCode!: string | null;
  @Column({ name: 'latitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  latitude!: string | null;
  @Column({ name: 'longitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  longitude!: string | null;
  @Column({ name: 'google_place_id', type: 'varchar', length: 255, nullable: true })
  googlePlaceId!: string | null;
  @Column({
    name: 'location_source',
    type: 'enum',
    enum: [...LOCATION_SOURCES],
    default: 'manual',
  })
  locationSource!: LocationSource;
  @Column({ name: 'geofence_radius_m', type: 'integer', default: DEFAULT_GEOFENCE_RADIUS_M })
  geofenceRadiusM!: number;
  /** Site receiving person (POC) at this unloading point. */
  @Column({ name: 'poc_name', type: 'varchar', length: 150, nullable: true })
  pocName!: string | null;
  @Column({ name: 'poc_phone', type: 'varchar', length: 15, nullable: true })
  pocPhone!: string | null;
  @Column({ name: 'poc_email', type: 'varchar', length: 255, nullable: true })
  pocEmail!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => CustomerEntity, (customer) => customer.deliveryPoints, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
