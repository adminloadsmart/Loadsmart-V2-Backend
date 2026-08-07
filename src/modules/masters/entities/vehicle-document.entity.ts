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
import { VehicleEntity } from './vehicle.entity';
import {
  VEHICLE_DOCUMENT_STATUSES,
  VEHICLE_DOCUMENT_TYPES,
  VehicleDocumentStatus,
  VehicleDocumentType,
} from '../utils/vehicle.type';

@Entity({ schema: 'masters', name: 'vehicle_documents' })
@Index('vehicle_documents_tenant_id_idx', ['tenantId'])
@Index('vehicle_documents_vehicle_id_idx', ['vehicleId'])
@Index('vehicle_documents_expiry_date_idx', ['expiryDate'])
export class VehicleDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(() => VehicleEntity, (vehicle) => vehicle.documents, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: VehicleEntity;

  @Column({
    name: 'document_type',
    type: 'enum',
    enum: [...VEHICLE_DOCUMENT_TYPES],
  })
  documentType!: VehicleDocumentType;

  @Column({ name: 'document_number', type: 'varchar', length: 50, nullable: true })
  documentNumber!: string | null;

  @Column({ name: 'issue_date', type: 'date', nullable: true })
  issueDate!: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate!: string | null;

  @Column({ name: 'file_url', type: 'text', nullable: true })
  fileUrl!: string | null;

  @Column({ type: 'enum', enum: [...VEHICLE_DOCUMENT_STATUSES], default: 'valid' })
  status!: VehicleDocumentStatus;

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
