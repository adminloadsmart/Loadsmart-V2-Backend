import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { BatterySohReadingEntity } from './battery-soh-reading.entity';

/** An electric truck's traction pack and its warranty terms. */
@Entity({ schema: 'maintenance', name: 'battery_packs' })
@Index('battery_packs_tenant_id_idx', ['tenantId'])
@Index('battery_packs_vehicle_id_idx', ['vehicleId'])
export class BatteryPackEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'serial_number', type: 'varchar', length: 50, nullable: true })
  serialNumber!: string | null;

  @Column({ name: 'capacity_kwh', type: 'numeric', precision: 7, scale: 2, nullable: true })
  capacityKwh!: string | null;

  @Column({ name: 'warranty_start', type: 'date' })
  warrantyStart!: string;

  @Column({ name: 'warranty_end', type: 'date' })
  warrantyEnd!: string;

  /** State of Health below which the pack is a warranty claim, in percent. */
  @Column({
    name: 'warranty_soh_floor_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 70,
  })
  warrantySohFloorPct!: string;

  @OneToMany(() => BatterySohReadingEntity, (reading) => reading.batteryPack)
  readings!: BatterySohReadingEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
