import { OrganizationJourneyStage, OrganizationStatus } from './entities/organization.entity';

// Allow-list, not deny-list: onboarding states (pending/partial_pending/draft) must stay
// accessible — the org still needs to hit POST /auth/organization to finish its profile. Only
// rejected/suspended actually block API access. Any future status defaults to blocked (fails
// closed) simply by not being added here.
export const TENANT_ACCESSIBLE_STATUSES: readonly OrganizationStatus[] = [
  'active',
  'pending',
  'partial_pending',
  'draft',
];

export function isTenantAccessible(status: OrganizationStatus): boolean {
  return TENANT_ACCESSIBLE_STATUSES.includes(status);
}

// Ordering for OrganizationJourneyStageService.recordTransition's forward-only guard.
// approved/rejected are terminal decisions, ranked equal-highest so either always wins regardless
// of current stage (mirrors how `status` is already set unconditionally by approve/reject today).
const JOURNEY_STAGE_ORDER: Record<OrganizationJourneyStage, number> = {
  application_submitted: 0,
  online_kyc: 1,
  online_kyc_completed: 2,
  physical_kyc: 3,
  final_approval: 4,
  approved: 5,
  rejected: 5,
};

// onlineKycVerifierId/physicalKycAgentId are two independent assignment fields that can be set in
// either order, so assigning the online verifier *after* the physical agent must not regress the
// stage from 'physical_kyc' back to 'online_kyc' — the assignment itself still succeeds either
// way, only the stage advance is guarded here.
export function nextJourneyStage(
  current: OrganizationJourneyStage | null,
  target: OrganizationJourneyStage,
): OrganizationJourneyStage {
  if (target === 'approved' || target === 'rejected') return target;
  if (!current) return target;
  return JOURNEY_STAGE_ORDER[target] > JOURNEY_STAGE_ORDER[current] ? target : current;
}

// Per-type format check for a submitted organization document's `documentNumber` — see
// auth.validators.ts's createOrganization. `shop_establishment` has no standardized national
// number format (state-specific), so it's validated as a non-empty string only (null here means
// "no regex check").
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;

export const DOCUMENT_NUMBER_REGEX: Record<
  import('./entities/organization-document.entity').OrganizationDocumentType,
  RegExp | null
> = {
  gst_certificate: GSTIN_REGEX,
  udyam: UDYAM_REGEX,
  cin: CIN_REGEX,
  shop_establishment: null,
};

// A referral code as admin-typed/generated: uppercase letters/digits plus - and _, 4-40 chars.
// Enforced both at the API boundary (admin.validators.ts's createReferralCode) and again in
// referral-code.service.ts (defense in depth for any other caller of createCode).
export const REFERRAL_CODE_REGEX = /^[A-Z0-9_-]{4,40}$/;
