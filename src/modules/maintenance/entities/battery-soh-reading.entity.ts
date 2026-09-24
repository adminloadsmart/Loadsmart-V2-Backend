import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BatteryPackEntity } from './battery-pack.entity';

/** Month-by-month State of Health for a pack — one reading per pack per calendar month. */
@Entity({ schema: 'maintenance', name: 'battery_soh_readings' })
@Index('battery_soh_readings_tenant_id_idx', ['tenantId'])
@Index('battery_soh_readings_pack_month_unique', ['batteryPackId', 'readingMonth'], {
  unique: true,
})
export class BatterySohReadingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'battery_pack_id', type: 'uuid' })
  batteryPackId!: string;

  @ManyToOne(() => BatteryPackEntity, (pack) => pack.readings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battery_pack_id' })
  batteryPack!: BatteryPackEntity;

  /** Always the first of the month (normalised on write). */
  @Column({ name: 'reading_month', type: 'date' })
  readingMonth!: string;

  @Column({ name: 'soh_pct', type: 'numeric', precision: 5, scale: 2 })
  sohPct!: string;

  @Column({ name: 'odometer_km', type: 'int', nullable: true })
  odometerKm!: number | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
