import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VehicleEntity } from './vehicle.entity';
import { COST_PAYERS, TOLL_PAYERS, VehicleCostPayer, VehicleTollPayer } from '../vehicle.type';

@Entity({ schema: 'masters', name: 'vehicle_telemetry_meta' })
@Index('vehicle_telemetry_meta_tenant_id_idx', ['tenantId'])
@Index('vehicle_telemetry_meta_vehicle_id_unique', ['vehicleId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class VehicleTelemetryMetaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @OneToOne(() => VehicleEntity, (vehicle) => vehicle.telemetryMeta, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'gps_provider', type: 'varchar', length: 100, nullable: true })
  gpsProvider!: string | null;

  /** Whether the GPS is connected and reporting — distinct from hasGps (a device is fitted). */
  @Column({ name: 'gps_enabled', type: 'boolean', default: false })
  gpsEnabled!: boolean;

  /** The drawer's "Does this truck have a GPS?" — null when it wasn't answered. */
  @Column({ name: 'has_gps', type: 'boolean', nullable: true })
  hasGps!: boolean | null;

  @Column({ name: 'gps_device_imei', type: 'varchar', length: 15, nullable: true })
  gpsDeviceImei!: string | null;

  @Column({ name: 'emi_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  emiAmount!: string | null;

  @Column({ name: 'emi_end_date', type: 'date', nullable: true })
  emiEndDate!: string | null;

  @Column({
    name: 'insurance_premium_yearly',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  insurancePremiumYearly!: string | null;

  /** Attached trucks: rent paid to the owner. Runs whether the truck moves or not. */
  @Column({ name: 'lease_rent_monthly', type: 'numeric', precision: 12, scale: 2, nullable: true })
  leaseRentMonthly!: string | null;

  @Column({ name: 'lease_end_date', type: 'date', nullable: true })
  leaseEndDate!: string | null;

  @Column({ name: 'fuel_paid_by', type: 'enum', enum: [...COST_PAYERS], nullable: true })
  fuelPaidBy!: VehicleCostPayer | null;

  @Column({ name: 'toll_paid_by', type: 'enum', enum: [...TOLL_PAYERS], nullable: true })
  tollPaidBy!: VehicleTollPayer | null;

  /** Everything that runs whether the truck moves or not (EMI, insurance, permit, salaries…), per
   *  month — the "fixed cost that ran anyway" on the maintenance downtime headline. Falls back to
   *  emi_amount when null. */
  @Column({ name: 'fixed_cost_monthly', type: 'numeric', precision: 12, scale: 2, nullable: true })
  fixedCostMonthly!: string | null;

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
