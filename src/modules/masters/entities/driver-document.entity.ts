import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DriverEntity } from './driver.entity';
import {
  DRIVER_DOCUMENT_TYPES,
  DRIVER_DOCUMENT_VERIFICATION_SOURCES,
  DriverDocumentType,
  DriverDocumentVerificationSource,
} from '../utils/drivers.types';

@Entity({ schema: 'masters', name: 'driver_documents' })
@Index('driver_documents_tenant_id_idx', ['tenantId'])
@Index('driver_documents_driver_id_idx', ['driverId'])
export class DriverDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId!: string;

  @ManyToOne(() => DriverEntity, (driver) => driver.documents, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'driver_id' })
  driver!: DriverEntity;

  @Column({
    name: 'document_type',
    type: 'enum',
    enum: [...DRIVER_DOCUMENT_TYPES],
  })
  documentType!: DriverDocumentType;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl!: string;

  // Aadhaar/PAN number for ID-proof documents; left null for licence photos.
  @Column({ name: 'document_number', type: 'varchar', length: 50, nullable: true })
  documentNumber!: string | null;

  @Column({
    name: 'verification_source',
    type: 'enum',
    enum: [...DRIVER_DOCUMENT_VERIFICATION_SOURCES],
  })
  verificationSource!: DriverDocumentVerificationSource;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
