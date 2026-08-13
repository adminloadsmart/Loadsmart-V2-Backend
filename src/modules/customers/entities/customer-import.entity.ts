import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CustomerImportStatus = 'previewed' | 'completed' | 'completed_with_errors' | 'failed';

@Entity({ schema: 'customers', name: 'customer_imports' })
export class CustomerImportEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'uploaded_by', type: 'uuid' }) uploadedBy!: string;
  // The default keeps TypeORM synchronize safe when upgrading an existing import table that
  // already contains rows but does not yet have this column. New imports always provide it.
  @Column({ name: 'file_name', type: 'varchar', length: 255, default: 'legacy-import.csv' })
  fileName!: string;
  @Column({
    type: 'enum',
    enum: ['previewed', 'completed', 'completed_with_errors', 'failed'],
    default: 'previewed',
  })
  status!: CustomerImportStatus;
  @Column({ name: 'total_rows', type: 'integer', default: 0 }) totalRows!: number;
  @Column({ name: 'created_rows', type: 'integer', default: 0 }) createdRows!: number;
  @Column({ name: 'skipped_rows', type: 'integer', default: 0 }) skippedRows!: number;
  @Column({ name: 'failed_rows', type: 'integer', default: 0 }) failedRows!: number;
  @Column({ name: 'column_mapping', type: 'jsonb', default: {} }) columnMapping!: Record<
    string,
    string
  >;
  @Column({ type: 'jsonb', default: [] }) errors!: unknown[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
