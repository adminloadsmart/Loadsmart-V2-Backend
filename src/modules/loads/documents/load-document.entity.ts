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
  LOAD_DOCUMENT_REVIEW_STATUSES,
  LOAD_DOCUMENT_SOURCES,
  LOAD_DOCUMENT_TYPES,
  LoadDocumentReviewStatus,
  LoadDocumentSource,
  LoadDocumentType,
} from './load-document.types';

/**
 * The load's documents register: every file ever attached, versioned per type. A re-upload adds
 * the next version and supersedes the current one (superseded_at) — nothing is overwritten. The
 * current version is the one not superseded; for single-file types at most one (a partial unique
 * index), loading photos may have several. Rows are written only by LoadDocumentService, in the
 * same transaction as the load's pointer column (load-document.types.ts DOCUMENT_COLUMNS).
 */
@Entity({ schema: 'loads', name: 'load_documents' })
@Index('load_documents_load_type_idx', ['loadId', 'docType', 'version'], { unique: true })
@Index('load_documents_one_current_per_type', ['loadId', 'docType'], {
  unique: true,
  where: `"superseded_at" IS NULL AND "doc_type" NOT IN ('loading_photo', 'charge_proof', 'claim_evidence')`,
})
@Index('load_documents_tenant_review_idx', ['tenantId', 'reviewStatus'])
export class LoadDocumentEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'load_id', type: 'uuid' }) loadId!: string;
  @ManyToOne(() => LoadEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'load_id', foreignKeyConstraintName: 'FK_load_documents_load' })
  load?: LoadEntity;
  @Column({ name: 'doc_type', type: 'enum', enum: [...LOAD_DOCUMENT_TYPES] })
  docType!: LoadDocumentType;
  @Column({ name: 'file_key', type: 'text' }) fileKey!: string;
  /** 1, 2, … per (load, type). */
  @Column({ type: 'integer' }) version!: number;
  /** The version this one replaced. */
  @Column({ name: 'supersedes_id', type: 'uuid', nullable: true }) supersedesId!: string | null;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
  @Column({ type: 'enum', enum: [...LOAD_DOCUMENT_SOURCES] }) source!: LoadDocumentSource;
  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true }) uploadedBy!: string | null;
  @Column({ name: 'uploaded_by_driver_id', type: 'uuid', nullable: true })
  uploadedByDriverId!: string | null;
  @Column({
    name: 'review_status',
    type: 'enum',
    enum: [...LOAD_DOCUMENT_REVIEW_STATUSES],
  })
  reviewStatus!: LoadDocumentReviewStatus;
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true }) reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  /** What was read off or typed with it — e.g. { number }. */
  @Column({ type: 'jsonb', nullable: true }) extracted!: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
