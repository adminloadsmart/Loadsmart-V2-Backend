import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  TRANSPORTER_COMPANY_TYPES,
  TRANSPORTER_STATUSES,
  TransporterCompanyType,
  TransporterStatus,
} from '../transporter.types';

@Entity({ schema: 'masters', name: 'transporters' })
@Index('transporters_tenant_id_idx', ['tenantId'])
@Index('transporters_tenant_phone_active_unique', ['tenantId', 'phone'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class TransporterEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ type: 'varchar', length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 15 }) phone!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) rate!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 15, nullable: true }) gstin!: string | null;
  @Column({ name: 'msme_registration', type: 'varchar', length: 50, nullable: true })
  msmeRegistration!: string | null;
  @Column({
    name: 'company_type',
    type: 'enum',
    enum: [...TRANSPORTER_COMPANY_TYPES],
    nullable: true,
  })
  companyType!: TransporterCompanyType | null;
  @Column({ name: 'advance_percentage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  advancePercentage!: string | null;
  @Column({ name: 'credit_days', type: 'integer', nullable: true }) creditDays!: number | null;
  @Column({ name: 'address_line_1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;
  @Column({ name: 'address_line_2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) landmark!: string | null;
  @Column({ name: 'area_locality', type: 'varchar', length: 255, nullable: true })
  areaLocality!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) state!: string | null;
  @Column({ name: 'pin_code', type: 'varchar', length: 10, nullable: true })
  pinCode!: string | null;
  @Column({ name: 'bank_account_number', type: 'varchar', length: 30, nullable: true })
  bankAccountNumber!: string | null;
  @Column({ name: 'bank_ifsc', type: 'varchar', length: 11, nullable: true })
  bankIfsc!: string | null;
  @Column({ name: 'bank_account_holder_name', type: 'varchar', length: 150, nullable: true })
  bankAccountHolderName!: string | null;
  @Column({ type: 'enum', enum: [...TRANSPORTER_STATUSES], default: 'active' })
  status!: TransporterStatus;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
