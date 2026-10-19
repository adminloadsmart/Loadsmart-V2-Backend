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
import { TransporterEntity } from './transporter.entity';

/** Add/Edit Transporter "Points of contact (POC)" — one row per POC card. */
@Entity({ schema: 'masters', name: 'transporter_contacts' })
@Index('transporter_contacts_tenant_transporter_idx', ['tenantId', 'transporterId'])
export class TransporterContactEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'transporter_id', type: 'uuid' }) transporterId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'full_name', type: 'varchar', length: 150, nullable: true })
  fullName!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) designation!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) phone!: string | null;
  @Column({ name: 'is_whatsapp', type: 'boolean', default: false }) isWhatsapp!: boolean;
  @Column({ type: 'varchar', length: 255, nullable: true }) email!: string | null;
  @Column({ name: 'sort_order', type: 'smallint', default: 0 }) sortOrder!: number;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => TransporterEntity, (transporter) => transporter.contacts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'transporter_id' })
  transporter!: TransporterEntity;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
