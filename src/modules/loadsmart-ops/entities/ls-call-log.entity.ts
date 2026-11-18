import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { CallContact, CallOutcome, EtaTarget, LocationSource } from '../loadsmart.types';

/** One call Tracking made about a Loadsmart load — to the driver, the broker or someone else. It
 *  doubles as the truck's last known location and its ETA to the loading (or unloading) point
 *  when the call gave them; with SIM tracking on, the location is filled in from the tracking
 *  service. Append-only, like the load's timeline. */
@Entity({ schema: 'loads', name: 'ls_call_logs' })
@Index('ls_call_logs_load_idx', ['loadId', 'calledAt'])
export class LsCallLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @Column({ name: 'sourcing_id', type: 'uuid' })
  sourcingId!: string;

  @Column({ name: 'called_by', type: 'uuid' })
  calledBy!: string;

  @Column({ name: 'called_at', type: 'timestamptz' })
  calledAt!: Date;

  @Column({ type: 'varchar', length: 20 })
  contact!: CallContact;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  /** The broker called (Placement's broker calls). */
  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  /** The rate the broker quoted on the call. */
  @Column({ name: 'quoted_rate', type: 'numeric', precision: 12, scale: 2, nullable: true })
  quotedRate!: string | null;

  @Column({ type: 'varchar', length: 20 })
  outcome!: CallOutcome;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'location_label', type: 'varchar', length: 200, nullable: true })
  locationLabel!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitude!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitude!: string | null;

  @Column({ name: 'location_source', type: 'varchar', length: 20, nullable: true })
  locationSource!: LocationSource | null;

  @Column({ name: 'eta_at', type: 'timestamptz', nullable: true })
  etaAt!: Date | null;

  @Column({ name: 'eta_target', type: 'varchar', length: 20, nullable: true })
  etaTarget!: EtaTarget | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
