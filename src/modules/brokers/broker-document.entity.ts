import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerEntity } from './broker.entity';

export const BROKER_DOCUMENT_TYPES = [
  'pan_card',
  'aadhaar',
  'gst_certificate',
  'cancelled_cheque',
  'agreement',
  'trade_licence',
  'other',
] as const;
export type BrokerDocumentType = (typeof BROKER_DOCUMENT_TYPES)[number];

/** A document on file for a broker — its details only (no file). */
@Entity({ schema: 'brokers', name: 'broker_documents' })
@Index('broker_documents_broker_idx', ['brokerId'])
export class BrokerDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'broker_id', type: 'uuid' })
  brokerId!: string;

  @ManyToOne(() => BrokerEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_id', foreignKeyConstraintName: 'FK_broker_documents_broker' })
  broker?: BrokerEntity;

  @Column({ name: 'doc_type', type: 'varchar', length: 40 })
  docType!: BrokerDocumentType;

  @Column({ name: 'doc_number', type: 'varchar', length: 50, nullable: true })
  docNumber!: string | null;

  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn!: string | null;

  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
