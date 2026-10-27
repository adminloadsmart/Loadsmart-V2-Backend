import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoadEntity } from '../entities/load.entity';
import {
  VERIFICATION_STATUSES,
  VERIFICATION_SUBJECTS,
  VerificationStatus,
  VerificationSubject,
} from '../utils/loads.types';

/**
 * One govt-portal check of a truck (VAHAN: RC, fitness, insurance, PUC, permit) or a driver
 * (Sarathi: licence found, valid, and its class covers the truck) put on a load. `failures` holds
 * only what failed — that's all the shipper is shown. `unavailable` means the portal couldn't be
 * reached; it never blocks, the same way the driver onboarding check doesn't.
 */
@Entity({ schema: 'loads', name: 'load_verifications' })
@Index('load_verifications_tenant_load_idx', ['tenantId', 'loadId'])
@Index('load_verifications_tenant_subject_idx', ['tenantId', 'subject', 'subjectRef'])
export class LoadVerificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  /** The bid whose truck was checked; null for the load's own truck or its driver. */
  @Column({ name: 'bid_id', type: 'uuid', nullable: true })
  bidId!: string | null;

  @Column({ type: 'enum', enum: [...VERIFICATION_SUBJECTS] })
  subject!: VerificationSubject;

  /** Truck number or licence number. */
  @Column({ name: 'subject_ref', type: 'varchar', length: 30 })
  subjectRef!: string;

  @Column({ type: 'enum', enum: [...VERIFICATION_STATUSES] })
  status!: VerificationStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  failures!: string[];

  /** Non-blocking remarks, e.g. "Truck weight unknown" or why the portal was unavailable. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  notes!: string[];

  @Column({ name: 'gross_vehicle_weight_kg', type: 'int', nullable: true })
  grossVehicleWeightKg!: number | null;

  /** What the registry returned that the check used (papers, licence classes, validity). */
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ name: 'checked_at', type: 'timestamptz' })
  checkedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
