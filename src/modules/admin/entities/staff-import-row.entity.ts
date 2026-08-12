import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StaffImportEntity } from './staff-import.entity';

@Entity({ schema: 'auth', name: 'staff_import_rows' })
export class StaffImportRowEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'import_id', type: 'uuid' }) importId!: string;
  @Column({ name: 'row_number', type: 'integer' }) rowNumber!: number;
  @Column({ type: 'varchar', length: 20 }) status!: 'valid' | 'invalid' | 'created' | 'failed';
  @Column({ name: 'normalized_data', type: 'jsonb' }) normalizedData!: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) errors!: Record<string, unknown>[] | null;
  @Column({ name: 'created_user_id', type: 'uuid', nullable: true }) createdUserId!: string | null;
  @ManyToOne(() => StaffImportEntity, (staffImport) => staffImport.rows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'import_id' })
  import!: StaffImportEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
