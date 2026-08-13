import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FileStatus, FILE_STATUSES } from '../utils/file-status';
import { UploadPurpose, UPLOAD_PURPOSES } from '../storage.constants';

@Entity({ schema: 'storage', name: 'files' })
@Index('files_tenant_id_idx', ['tenantId'])
@Index('files_status_created_at_idx', ['status', 'createdAt'])
@Index('files_key_idx', ['key'], { unique: true })
export class FileEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  // Nullable: a platform-scope caller (sales/online_kyc_desk/offline_kyc_desk/load_console — see
  // PLATFORM_SCOPE_ROLES) has no tenant of its own. Such a file is never re-attributed to a
  // tenant later; see storage.repository.ts's findByNullTenant/markConfirmedByNullTenant for the
  // matching tenant-less lookup/update paths, scoped only to rows with tenant_id IS NULL.
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true }) tenantId!: string | null;
  @Column({ name: 'uploaded_by', type: 'uuid' }) uploadedBy!: string;
  @Column({ type: 'enum', enum: [...UPLOAD_PURPOSES] }) purpose!: UploadPurpose;
  @Column({ type: 'text' }) key!: string;
  @Column({ name: 'original_file_name', type: 'varchar', length: 255 }) originalFileName!: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 255 }) mimeType!: string;
  // Client-declared at create time (used only to reject an obviously-oversized request up front);
  // overwritten with the real value from S3's HeadObject response once the upload is confirmed.
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes!: number;
  @Column({ type: 'enum', enum: [...FILE_STATUSES], default: 'pending' }) status!: FileStatus;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
