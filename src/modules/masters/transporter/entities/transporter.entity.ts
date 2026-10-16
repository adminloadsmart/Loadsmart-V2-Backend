import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  TRANSPORTER_BANK_VERIFICATION_STATUSES,
  TRANSPORTER_COMPANY_TYPES,
  TRANSPORTER_GST_TREATMENTS,
  TRANSPORTER_STATUSES,
  TransporterBankVerificationStatus,
  TransporterCompanyType,
  TransporterGstTreatment,
  TransporterStatus,
} from '../transporter.types';
import { GST_RECORD_STATUSES, GstRecordStatus } from '../../gst/gst.types';
import { PICKER_BODIES, PickerBody } from '../../vehicle/truck-type-picker.constants';
import { TransporterContactEntity } from './transporter-contact.entity';
import { TransporterLaneEntity } from './transporter-lane.entity';

@Entity({ schema: 'masters', name: 'transporters' })
@Index('transporters_tenant_id_idx', ['tenantId'])
@Index('transporters_tenant_phone_active_unique', ['tenantId', 'phone'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Index('transporters_tenant_code_unique', ['tenantId', 'code'], {
  unique: true,
  where: '"code" IS NOT NULL AND "deleted_at" IS NULL',
})
export class TransporterEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  /** Display code `TRP-nnnn` ("Master Record #TRP-1049"), tenant-wide sequential. */
  @Column({ type: 'varchar', length: 20, nullable: true }) code!: string | null;
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
  // --- Settings redesign: GST register, fleet, settlement ---
  @Column({ type: 'varchar', length: 10, nullable: true }) pan!: string | null;
  /** GST register "constitution of business", e.g. "Partnership Firm". */
  @Column({ type: 'varchar', length: 100, nullable: true }) constitution!: string | null;
  @Column({ name: 'gst_state_code', type: 'varchar', length: 2, nullable: true })
  gstStateCode!: string | null;
  @Column({
    name: 'gst_verification_status',
    type: 'enum',
    enum: [...GST_RECORD_STATUSES],
    default: 'unverified',
  })
  gstVerificationStatus!: GstRecordStatus;
  @Column({ name: 'gst_verification_id', type: 'uuid', nullable: true })
  gstVerificationId!: string | null;
  @Column({ name: 'gst_verified_at', type: 'timestamptz', nullable: true })
  gstVerifiedAt!: Date | null;
  @Column({ name: 'gst_registry_name', type: 'varchar', length: 255, nullable: true })
  gstRegistryName!: string | null;
  @Column({ name: 'gst_name_matched', type: 'boolean', nullable: true })
  gstNameMatched!: boolean | null;
  @Column({
    name: 'gst_treatment',
    type: 'enum',
    enum: [...TRANSPORTER_GST_TREATMENTS],
    nullable: true,
  })
  gstTreatment!: TransporterGstTreatment | null;
  @Column({ name: 'trucks_declared', type: 'integer', nullable: true })
  trucksDeclared!: number | null;
  @Column({ name: 'truck_body_type', type: 'enum', enum: [...PICKER_BODIES], nullable: true })
  truckBodyType!: PickerBody | null;
  @Column({ name: 'truck_wheel_count', type: 'smallint', nullable: true })
  truckWheelCount!: number | null;
  @Column({ name: 'truck_capacity_tons', type: 'numeric', precision: 6, scale: 2, nullable: true })
  truckCapacityTons!: string | null;
  @Column({ name: 'truck_length_ft', type: 'numeric', precision: 5, scale: 1, nullable: true })
  truckLengthFt!: string | null;
  @Column({ name: 'upi_vpa', type: 'varchar', length: 100, nullable: true })
  upiVpa!: string | null;
  @Column({ name: 'bank_name_branch', type: 'varchar', length: 150, nullable: true })
  bankNameBranch!: string | null;
  @Column({
    name: 'bank_verification_status',
    type: 'enum',
    enum: [...TRANSPORTER_BANK_VERIFICATION_STATUSES],
    nullable: true,
  })
  bankVerificationStatus!: TransporterBankVerificationStatus | null;
  @Column({ name: 'bank_verified_at', type: 'timestamptz', nullable: true })
  bankVerifiedAt!: Date | null;
  @Column({ name: 'bank_name_at_bank', type: 'varchar', length: 150, nullable: true })
  bankNameAtBank!: string | null;
  @Column({ name: 'bank_verification_reference', type: 'varchar', length: 100, nullable: true })
  bankVerificationReference!: string | null;
  @Column({ name: 'bank_raw_response', type: 'jsonb', nullable: true })
  bankRawResponse!: Record<string, unknown> | null;
  @OneToMany(() => TransporterContactEntity, (contact) => contact.transporter)
  contacts!: TransporterContactEntity[];
  @OneToMany(() => TransporterLaneEntity, (lane) => lane.transporter)
  lanes!: TransporterLaneEntity[];
  @Column({ type: 'enum', enum: [...TRANSPORTER_STATUSES], default: 'active' })
  status!: TransporterStatus;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
