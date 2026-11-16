import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoadEntity } from './load.entity';
import { LoadStatus } from '../utils/loads.types';

export const TRUCK_CANCELLATION_NEXT_STEPS = ['new_truck', 'reopen'] as const;
export type TruckCancellationNextStep = (typeof TRUCK_CANCELLATION_NEXT_STEPS)[number];

/** A truck cancelled between Truck assigned and Loaded, with its reason code (Settings) and what
 *  happened next: the same transporter sends another truck, or the load goes back to Created.
 *  "The earlier memo, truck, driver and the cancellation stay on the load's history." */
@Entity({ schema: 'loads', name: 'load_cancellations' })
@Index('load_cancellations_load_idx', ['loadId'])
export class LoadCancellationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_cancellations_load' })
  load?: LoadEntity;
  @Column({ name: 'reason_code', type: 'varchar', length: 50 }) reasonCode!: string;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @Column({
    name: 'next_step',
    type: 'enum',
    enum: [...TRUCK_CANCELLATION_NEXT_STEPS],
  })
  nextStep!: TruckCancellationNextStep;
  /** The stage the load was at, and the truck and driver that were cancelled. */
  @Column({ name: 'from_stage', type: 'varchar', length: 32 }) fromStage!: LoadStatus;
  @Column({ name: 'transporter_id', type: 'uuid', nullable: true }) transporterId!: string | null;
  @Column({ name: 'vehicle_number', type: 'varchar', length: 20, nullable: true })
  vehicleNumber!: string | null;
  @Column({ name: 'driver_name', type: 'varchar', length: 150, nullable: true })
  driverName!: string | null;
  @Column({ name: 'driver_mobile', type: 'varchar', length: 20, nullable: true })
  driverMobile!: string | null;
  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true }) cancelledBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
