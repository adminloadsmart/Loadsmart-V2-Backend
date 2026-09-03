import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { FleetDriverLinkEntity } from '../../fleet-driver-link/entities/fleet-driver-link.entity';
import { DriverDocumentEntity } from './driver-document.entity';
import { DriverVerificationEntity } from './driver-verification.entity';
import { DriverBankDetailsEntity } from './driver-bank-details.entity';
import {
  DRIVER_BLOOD_GROUPS,
  DRIVER_SALARY_TYPES,
  DRIVER_STATUSES,
  DriverBloodGroup,
  DriverSalaryType,
  DriverStatus,
} from '../drivers.types';
import { DriverOperationalStatusEntity } from './driver-operational-status.entity';
import { DriverTripMetricsEntity } from './driver-trip-metrics.entity';

@Entity({ schema: 'masters', name: 'drivers' })
@Index('drivers_tenant_id_idx', ['tenantId'])
@Index('drivers_tenant_phone_number_active_unique', ['tenantId', 'phoneNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
// NULL licence numbers do not collide in Postgres, so drivers pending a licence stay insertable.
@Index('drivers_tenant_license_number_active_unique', ['tenantId', 'licenseNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class DriverEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 15 })
  phoneNumber!: string;

  @Column({ name: 'license_number', type: 'varchar', length: 30, nullable: true })
  licenseNumber!: string | null;

  @Column({ name: 'license_verified', type: 'boolean', default: false })
  licenseVerified!: boolean;

  @Column({ name: 'license_expiry', type: 'date', nullable: true })
  licenseExpiry!: string | null;

  @Column({ name: 'date_of_joining', type: 'date', nullable: true })
  dateOfJoining!: string | null;

  // Required by the Sarathi DL check (IDfy's verify_with_source needs id_number + date_of_birth
  // together), so it's captured on the driver even though nothing else in the product needs it yet.
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ name: 'blood_group', type: 'enum', enum: [...DRIVER_BLOOD_GROUPS], nullable: true })
  bloodGroup!: DriverBloodGroup | null;

  @Column({ name: 'address_line1', type: 'varchar', length: 255, nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line2', type: 'varchar', length: 255, nullable: true })
  addressLine2!: string | null;

  @Column({ name: 'city', type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ name: 'pin_code', type: 'varchar', length: 6, nullable: true })
  pinCode!: string | null;

  @Column({ name: 'emergency_contact_name', type: 'varchar', length: 150, nullable: true })
  emergencyContactName!: string | null;

  @Column({ name: 'emergency_contact_phone', type: 'varchar', length: 15, nullable: true })
  emergencyContactPhone!: string | null;

  @Column({ name: 'salary_type', type: 'enum', enum: [...DRIVER_SALARY_TYPES], nullable: true })
  salaryType!: DriverSalaryType | null;

  @Column({ name: 'salary_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  salaryAmount!: string | null;

  @Column({ type: 'enum', enum: [...DRIVER_STATUSES], default: 'active' })
  status!: DriverStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  // Set by reject, cleared by approve — mirrors CustomerEntity.rejectionReason.
  @Column({ name: 'rejection_reason', type: 'varchar', nullable: true })
  rejectionReason!: string | null;

  @OneToMany(() => FleetDriverLinkEntity, (link) => link.driver)
  vehicleLinks!: FleetDriverLinkEntity[];

  @OneToMany(() => DriverDocumentEntity, (document) => document.driver)
  documents!: DriverDocumentEntity[];

  @OneToMany(() => DriverVerificationEntity, (verification) => verification.driver)
  verifications!: DriverVerificationEntity[];

  @OneToMany(() => DriverBankDetailsEntity, (bankDetails) => bankDetails.driver)
  bankDetails!: DriverBankDetailsEntity[];

  @OneToOne(() => DriverOperationalStatusEntity, (status) => status.driver)
  operationalStatus!: DriverOperationalStatusEntity;

  @OneToMany(() => DriverTripMetricsEntity, (metric) => metric.driver)
  tripMetrics!: DriverTripMetricsEntity[];

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
