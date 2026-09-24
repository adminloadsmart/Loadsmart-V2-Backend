import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { DriverDocumentEntity } from './driver-document.entity';
import { DriverVerificationEntity } from './driver-verification.entity';
import { DriverBankDetailsEntity } from './driver-bank-details.entity';
import { DriverTenantRelationEntity } from './driver-tenant-relation.entity';
import {
  DRIVER_BLOOD_GROUPS,
  DRIVER_ONBOARDING_STEPS,
  DRIVER_REGISTRATION_SOURCES,
  DRIVER_SALARY_TYPES,
  DriverBloodGroup,
  DriverOnboardingStep,
  DriverRegistrationSource,
  DriverSalaryType,
} from '../drivers.types';

// A driver profile is global (one row per person), not tenant-scoped — a driver links to many
// tenants via DriverTenantRelationEntity, which carries the approval workflow (status,
// initiatedBy, approvedBy). Employment fields (salary, dateOfJoining) stay here, on the shared
// profile: a driver is treated as having one job at a time, not a different salary per tenant. See
// docs/driver-auth.md and the driver-tenant-relation entity for the split rationale.
@Entity({ schema: 'masters', name: 'drivers' })
// Neither phone nor licence number is globally unique — both were only unique per tenant on the
// old tenant-scoped table, so either can legitimately collide across rows in the data today.
// App-layer lookups (findByPhoneNumber/findByLicenseNumber in driver.service.ts /
// driver-identity.service.ts) already prevent creating a new duplicate going forward, without
// requiring every existing row to be reconciled first. Plain indexes for lookup performance only.
@Index('drivers_phone_number_idx', ['phoneNumber'])
@Index('drivers_license_number_idx', ['licenseNumber'])
export class DriverEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  @Column({ name: 'salary_type', type: 'enum', enum: [...DRIVER_SALARY_TYPES], nullable: true })
  salaryType!: DriverSalaryType | null;

  @Column({ name: 'salary_amount', type: 'numeric', precision: 12, scale: 2, nullable: true })
  salaryAmount!: string | null;

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

  @Column({ name: 'emergency_contact_relation', type: 'varchar', length: 50, nullable: true })
  emergencyContactRelation!: string | null;

  @Column({ name: 'has_health_insurance', type: 'boolean', default: false })
  hasHealthInsurance!: boolean;

  @Column({ name: 'has_life_insurance', type: 'boolean', default: false })
  hasLifeInsurance!: boolean;

  @Column({
    name: 'registration_source',
    type: 'enum',
    enum: [...DRIVER_REGISTRATION_SOURCES],
    default: 'staff_created',
  })
  registrationSource!: DriverRegistrationSource;

  // Self-registration's 3-screen wizard progress — driver-app-only, null for staff-created
  // profiles. See drivers.types.ts's DRIVER_ONBOARDING_STEPS doc comment.
  @Column({
    name: 'onboarding_step',
    type: 'enum',
    enum: [...DRIVER_ONBOARDING_STEPS],
    nullable: true,
  })
  onboardingStep!: DriverOnboardingStep | null;

  @OneToMany(() => DriverDocumentEntity, (document) => document.driver)
  documents!: DriverDocumentEntity[];

  @OneToMany(() => DriverVerificationEntity, (verification) => verification.driver)
  verifications!: DriverVerificationEntity[];

  @OneToMany(() => DriverBankDetailsEntity, (bankDetails) => bankDetails.driver)
  bankDetails!: DriverBankDetailsEntity[];

  @OneToMany(() => DriverTenantRelationEntity, (relation) => relation.driver)
  tenantRelations!: DriverTenantRelationEntity[];

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
