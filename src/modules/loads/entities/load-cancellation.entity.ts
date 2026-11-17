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

/** `truck`: the truck came off and the load went on; `load`: the whole load was cancelled. */
export const CANCELLATION_KINDS = ['truck', 'load'] as const;
export type CancellationKind = (typeof CANCELLATION_KINDS)[number];

/** A load cancellation on a load Loadsmart has won waits for Super Admin (`pending`); every
 *  other cancellation takes effect at once (`approved`). */
export const CANCELLATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type CancellationStatus = (typeof CANCELLATION_STATUSES)[number];

/** A cancellation with its reason code (Settings):
 *  - a truck cancelled between Truck assigned and Loaded, and what happened next — the same
 *    transporter sends another truck, or the load goes back to Created ("the earlier memo, truck,
 *    driver and the cancellation stay on the load's history");
 *  - the whole load cancelled before Loaded — at once, or once Super Admin approves on a load
 *    Loadsmart has won. */
@Entity({ schema: 'loads', name: 'load_cancellations' })
@Index('load_cancellations_load_idx', ['loadId'])
@Index('load_cancellations_one_pending_per_load', ['loadId'], {
  unique: true,
  where: `"status" = 'pending'`,
})
export class LoadCancellationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_cancellations_load' })
  load?: LoadEntity;
  @Column({ name: 'reason_code', type: 'varchar', length: 50 }) reasonCode!: string;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @Column({ type: 'enum', enum: [...CANCELLATION_KINDS], default: 'truck' })
  kind!: CancellationKind;
  /** Truck cancellations only. */
  @Column({
    name: 'next_step',
    type: 'enum',
    enum: [...TRUCK_CANCELLATION_NEXT_STEPS],
    nullable: true,
  })
  nextStep!: TruckCancellationNextStep | null;
  @Column({ type: 'enum', enum: [...CANCELLATION_STATUSES], default: 'approved' })
  status!: CancellationStatus;
  /** Super Admin's decision on a pending load cancellation. */
  @Column({ name: 'decided_by', type: 'uuid', nullable: true }) decidedBy!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @Column({ name: 'decision_note', type: 'text', nullable: true }) decisionNote!: string | null;
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
