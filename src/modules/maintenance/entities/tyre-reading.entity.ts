import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TyreEntity } from './tyre.entity';

/** A tread-depth gauge reading — append-only, the latest one per tyre drives the tyres queue. */
@Entity({ schema: 'maintenance', name: 'tyre_readings' })
@Index('tyre_readings_tenant_id_idx', ['tenantId'])
@Index('tyre_readings_tyre_date_idx', ['tyreId', 'readingDate'])
export class TyreReadingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'tyre_id', type: 'uuid' })
  tyreId!: string;

  @ManyToOne(() => TyreEntity, (tyre) => tyre.readings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tyre_id' })
  tyre!: TyreEntity;

  @Column({ name: 'tread_mm', type: 'numeric', precision: 4, scale: 1 })
  treadMm!: string;

  @Column({ name: 'reading_date', type: 'date' })
  readingDate!: string;

  @Column({ name: 'odometer_km', type: 'int', nullable: true })
  odometerKm!: number | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
