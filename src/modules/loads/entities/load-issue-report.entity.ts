import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LoadEntity } from './load.entity';
import { LOAD_ISSUE_CATEGORIES, LoadIssueCategory } from '../utils/loads.types';

/**
 * A driver-reported problem on a load in progress ("Report An Issue" in the driver app) — pure
 * append-only, one row per report, no updatedAt, same convention as LoadActivityEntity. Every
 * report also gets a matching load_activities ISSUE_REPORTED entry (see load-issue.service.ts)
 * for the Load Detail timeline; this table is the structured, queryable record staff read via
 * GET /loads/:loadId/issues.
 */
@Entity({ schema: 'loads', name: 'load_issue_reports' })
@Index('load_issue_reports_tenant_load_idx', ['tenantId', 'loadId'])
export class LoadIssueReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'load_id', type: 'uuid' })
  loadId!: string;

  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id' })
  load!: LoadEntity;

  // No @ManyToOne/FK here, deliberately — this holds a masters.drivers.id, which doesn't exist in
  // auth.users, so an FK would hit the same violation audit_logs.user_id would (see
  // load-issue.service.ts's reportIssue — audit userId stays null for the same reason). Same
  // unconstrained-uuid convention as load_activities.actor_id / load_payments.recorded_by.
  @Column({ name: 'reported_by', type: 'uuid', nullable: true })
  reportedBy!: string | null;

  @Column({ type: 'enum', enum: [...LOAD_ISSUE_CATEGORIES] })
  category!: LoadIssueCategory;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6 })
  latitude!: string;

  @Column({ type: 'numeric', precision: 9, scale: 6 })
  longitude!: string;

  // Client-resolved address (on-device reverse geocoding today — e.g. "NH-48, near Behror,
  // Rajasthan"). TODO: replace with server-side Google Places reverse geocoding once that
  // integration exists; backend just stores whatever the client sends for now.
  @Column({ name: 'location_label', type: 'varchar', length: 255 })
  locationLabel!: string;

  // The GPS fix's own timestamp, not when the request reached the server.
  @Column({ name: 'location_captured_at', type: 'timestamptz' })
  locationCapturedAt!: Date;

  // Confirmed storage keys, purpose 'loads/issue' — see load-issue.service.ts's
  // assertLoadDocumentUpload loop.
  @Column({ name: 'photo_file_keys', type: 'text', array: true, nullable: true })
  photoFileKeys!: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
