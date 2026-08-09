import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrganizationDocumentEntity } from './organization-document.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { ReferralCodeEntity } from './referral-code.entity';

// Single source of truth for the status value set — reused by admin.validators.ts's zod schema
// so the two can't drift again the way they did before (DB had no 'suspended', validator had a
// phantom one and was missing 'rejected'/'partial_pending').
export const ORGANIZATION_STATUSES = [
  'active',
  'rejected',
  'pending',
  'partial_pending',
  'draft',
  'suspended',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_ONBOARDING_STEPS = [
  'company_details',
  'business_details',
  'review_submit',
  'submitted',
] as const;
export type OrganizationOnboardingStep = (typeof ORGANIZATION_ONBOARDING_STEPS)[number];

@Entity({ schema: 'auth', name: 'organizations' })
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  @Column({ type: 'enum', enum: ORGANIZATION_STATUSES })
  status!: OrganizationStatus;

  @Column({ name: 'company_legal_name', type: 'varchar', nullable: true })
  companyLegalName!: string | null;

  @Column({ name: 'registered_business_name', type: 'varchar', nullable: true })
  registeredBusinessName!: string | null;

  @Column({ name: 'org_admin_name', type: 'varchar', nullable: true })
  orgAdminName!: string | null;

  @Column({ name: 'operational_city', type: 'varchar', nullable: true })
  operationalCity!: string | null;

  @Column({
    name: 'onboarding_step',
    type: 'enum',
    enum: ORGANIZATION_ONBOARDING_STEPS,
    nullable: true,
  })
  onboardingStep!: OrganizationOnboardingStep | null;

  @Column({ name: 'registration_date', type: 'date', nullable: true })
  registrationDate!: string | null;

  @Column({ name: 'address_line_1', type: 'varchar', nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line_2', type: 'varchar', nullable: true })
  addressLine2!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', nullable: true })
  pinCode!: string | null;

  @Column({ name: 'has_own_fleet', type: 'boolean', nullable: true })
  hasOwnFleet!: boolean | null;

  @Column({ name: 'fleet_size', type: 'int', nullable: true })
  fleetSize!: number | null;

  @OneToMany(() => OrganizationDocumentEntity, (document) => document.organization)
  documents!: OrganizationDocumentEntity[];

  // Which sales rep's code (if any) this org signed up with — set once at signup by
  // AuthService.createOrganization, never editable afterward. SET NULL on delete since not
  // every org has a referral (nullable) and an org shouldn't be blocked by a code's lifecycle.
  @Column({ name: 'referral_code_id', type: 'uuid', nullable: true })
  referralCodeId!: string | null;

  @ManyToOne(() => ReferralCodeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'referral_code_id' })
  referralCode!: ReferralCodeEntity | null;

  // The two staff members responsible for reviewing this org — one per KYC track. Assignment is
  // record-keeping/routing only for now: /admin/* stays platform_admin-only, "no exceptions" (see
  // admin.routes.ts), so these fields don't yet grant the assignee themselves any access.
  @Column({ name: 'online_kyc_verifier_id', type: 'uuid', nullable: true })
  onlineKycVerifierId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'online_kyc_verifier_id' })
  onlineKycVerifier!: UserEntity | null;

  @Column({ name: 'physical_kyc_agent_id', type: 'uuid', nullable: true })
  physicalKycAgentId!: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'physical_kyc_agent_id' })
  physicalKycAgent!: UserEntity | null;

  // Set by reject/deny (why this decision was made), cleared by approve.
  @Column({ name: 'decision_reason', type: 'varchar', nullable: true })
  decisionReason!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
