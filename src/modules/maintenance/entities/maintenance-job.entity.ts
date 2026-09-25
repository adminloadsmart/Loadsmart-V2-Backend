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
import { TyreEntity } from './tyre.entity';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import {
  MAINTENANCE_JOB_STATUSES,
  MAINTENANCE_JOB_TYPES,
  MaintenanceJobStatus,
  MaintenanceJobType,
  SERVICE_TYPES,
  ServiceType,
} from '../maintenance.types';

export interface ReplacedPart {
  name: string;
  quantity: number;
  cost: number | null;
}

/**
 * One workshop visit by an own-fleet truck — a service or a breakdown. Either sits `open` while
 * the truck is in the workshop (and out of dispatch) and `closed` once it is back; a past service
 * logged after the fact lands `closed` directly. Both feed the spend/downtime headlines and the
 * job history; open breakdowns are the breakdowns queue.
 */
@Entity({ schema: 'maintenance', name: 'maintenance_jobs' })
@Index('maintenance_jobs_tenant_id_idx', ['tenantId'])
@Index('maintenance_jobs_tenant_opened_idx', ['tenantId', 'openedAt'])
@Index('maintenance_jobs_vehicle_id_idx', ['vehicleId'])
// A truck is either in the workshop or not — at most one open job (service or breakdown) each.
@Index('maintenance_jobs_open_unique', ['vehicleId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class MaintenanceJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({ name: 'job_type', type: 'enum', enum: [...MAINTENANCE_JOB_TYPES] })
  jobType!: MaintenanceJobType;

  @Column({ type: 'enum', enum: [...MAINTENANCE_JOB_STATUSES] })
  status!: MaintenanceJobStatus;

  /** Breakdown: when it broke down. Service: when the truck went into the workshop. */
  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  /** Breakdown: when it was put back in service. Service: when the truck came out. */
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'odometer_km', type: 'int', nullable: true })
  odometerKm!: number | null;

  @Column({ name: 'workshop_name', type: 'varchar', length: 150, nullable: true })
  workshopName!: string | null;

  /** Breakdown only — where it broke down. */
  @Column({ name: 'location_label', type: 'varchar', length: 255, nullable: true })
  locationLabel!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitude!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitude!: string | null;

  @Column({ type: 'boolean', default: false })
  towed!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Service only — "What was done" on Log a service. Null on a checked-in visit until it is logged. */
  @Column({ name: 'service_type', type: 'enum', enum: [...SERVICE_TYPES], nullable: true })
  serviceType!: ServiceType | null;

  /** Storage key of the uploaded invoice / work order (purpose `maintenance/invoice`). */
  @Column({ name: 'invoice_file_key', type: 'varchar', length: 512, nullable: true })
  invoiceFileKey!: string | null;

  /** Breakdown only — the due service was also done on this visit, so closing it reset the
   *  vehicle's service clock. Always false on a service job (it is one). */
  @Column({ name: 'includes_service', type: 'boolean', default: false })
  includesService!: boolean;

  @Column({ name: 'parts_replaced', type: 'jsonb', default: () => "'[]'" })
  partsReplaced!: ReplacedPart[];

  @Column({ name: 'labour_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  labourCost!: string | null;

  @Column({ name: 'parts_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  partsCost!: string | null;

  /** labour_cost + parts_cost, kept denormalised so the spend headline is a single SUM. */
  @Column({ name: 'total_cost', type: 'numeric', precision: 12, scale: 2, nullable: true })
  totalCost!: string | null;

  /** The driver's "Report An Issue" row this breakdown was raised from, if any — deliberately no
   *  FK, same cross-module reference style as load_issue_reports.reported_by. */
  @Column({ name: 'source_issue_report_id', type: 'uuid', nullable: true })
  sourceIssueReportId!: string | null;

  /** Tyre jobs only — the fitments this Record Tyre Maintenance entry made. */
  @OneToMany(() => TyreEntity, (tyre) => tyre.maintenanceJob)
  tyres?: TyreEntity[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
