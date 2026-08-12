import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StaffImportRowEntity } from './staff-import-row.entity';

export const STAFF_IMPORT_STATUSES = ['previewed', 'processing', 'completed', 'failed'] as const;
export type StaffImportStatus = (typeof STAFF_IMPORT_STATUSES)[number];

@Entity({ schema: 'auth', name: 'staff_imports' })
export class StaffImportEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'uploaded_by', type: 'uuid' }) uploadedBy!: string;
  @Column({ name: 'original_file_name', type: 'varchar', length: 255 }) originalFileName!: string;
  @Column({ name: 'file_hash', type: 'varchar', length: 64 }) fileHash!: string;
  @Column({ type: 'enum', enum: [...STAFF_IMPORT_STATUSES], default: 'previewed' })
  status!: StaffImportStatus;
  @Column({ type: 'jsonb' }) mapping!: Record<string, string>;
  @Column({ name: 'total_rows', type: 'integer', default: 0 }) totalRows!: number;
  @Column({ name: 'valid_rows', type: 'integer', default: 0 }) validRows!: number;
  @Column({ name: 'invalid_rows', type: 'integer', default: 0 }) invalidRows!: number;
  @Column({ name: 'successful_rows', type: 'integer', default: 0 }) successfulRows!: number;
  @Column({ name: 'failed_rows', type: 'integer', default: 0 }) failedRows!: number;
  @OneToMany(() => StaffImportRowEntity, (row) => row.import)
  rows!: StaffImportRowEntity[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
