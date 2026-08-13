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

// Where the org is in the post-submission KYC review pipeline — distinct from `status` (coarse
// lifecycle/access-control) and `onboardingStep` (pre-submission wizard progress, freezes at
// 'submitted'). Null until submitOrganization runs; advanced automatically by
// OrganizationJourneyStageService.recordTransition as a side effect of submit/assign/complete/
// approve/reject — see organization-journey-stage.service.ts. Same single-source-of-truth
// convention as the two enums above. online_kyc_completed is the handover moment to
// offline_kyc_desk (set by AdminService.completeOnlineKyc); final_approval is the offline agent's
// approval landing back with the source verifier (set by AdminService.approvePhysicalKyc) —
// see organization.constants.ts's JOURNEY_STAGE_ORDER for the forward-only ordering these two
// participate in.
export const ORGANIZATION_JOURNEY_STAGES = [
  'application_submitted',
  'online_kyc',
  'online_kyc_completed',
  'physical_kyc',
  'final_approval',
  'approved',
  'rejected',
] as const;
export type OrganizationJourneyStage = (typeof ORGANIZATION_JOURNEY_STAGES)[number];

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

  // The two staff members responsible for reviewing this org — one per KYC track. These are also
  // the authorization scope for the online_kyc_desk/offline_kyc_desk roles: AdminService's
  // assertOrgAccessible only lets a reviewer act on an org where they're the one assigned here
  // (platform_admin is exempt from this check). See admin.routes.ts for the per-route permission
  // gates and admin.service.ts for the ownership check itself.
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

  // Completion markers, set once each by AdminService.completeOnlineKyc / .approvePhysicalKyc —
  // distinct from the assignment fields above (which only say *who's* reviewing, not whether
  // they're done). onlineKycCompletedAt is the handover moment to offline_kyc_desk: until it's
  // set, assertOrgAccessible hides the org from the assigned physical agent entirely.
  // physicalKycApprovedAt then gates AdminService.approveOrganization granting platform access
  // (status → 'active'), alongside the existing all-documents-verified check.
  @Column({ name: 'online_kyc_completed_at', type: 'timestamptz', nullable: true })
  onlineKycCompletedAt!: Date | null;

  @Column({ name: 'physical_kyc_approved_at', type: 'timestamptz', nullable: true })
  physicalKycApprovedAt!: Date | null;

  // Set by reject/deny (why this decision was made), cleared by approve.
  @Column({ name: 'decision_reason', type: 'varchar', nullable: true })
  decisionReason!: string | null;

  // Current value only — see organization-journey-stage-history.entity.ts for the full trail of
  // every stage this org has passed through.
  @Column({
    name: 'journey_stage',
    type: 'enum',
    enum: ORGANIZATION_JOURNEY_STAGES,
    nullable: true,
  })
  journeyStage!: OrganizationJourneyStage | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
