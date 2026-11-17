// Roles are now a fixed, seeded catalog in auth.roles (see db/seed-roles.ts), not a closed
// compile-time set — Role is just a name string. These two constants survive because they're
// still referenced by name in code: requirePermission's platform_admin bypass, role.service.ts's
// assertCanManage, and auth.service.ts's verifyOtp bootstrap assignment.
export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const ORG_ADMIN_ROLE = 'org_admin';
// Named individually so admin.service.ts's referral-code owner assignment, ls-sourcing's bid rule
// and auth.service.ts's hire-time referral code can check this role without a raw string literal.
export const SALES_ROLE = 'sales';

// The Loadsmart staff teams (16 Nov Figma notes §4/§11) — one platform role per team, strictly one
// team per person (a user has exactly one role_id). The team decides all access; the per-team job
// title lives in users.team_role (TEAM_ROLES below) and has no effect on access.
//  - ADMIN_TEAM ("Admin" — the notes' "Super Admin") can do everything every ops team can, plus
//    masters and margin, but is NOT platform_admin: it never holds ADMIN_ORGANIZATIONS_MANAGE, so
//    it can't manage staff, roles, referral codes or org status (see db/role-catalog.ts).
//  - platform_admin is the single owner account, seed-only, never a team.
export const ADMIN_TEAM = 'ls_admin';
export const APPROVAL_TEAM = 'ls_approval';
export const PLACEMENT_TEAM = 'ls_placement';
export const TRACKING_TEAM = 'ls_tracking';
export const CS_TEAM = 'ls_cs';
export const RECEIVABLES_TEAM = 'ls_receivables';
export const PAYABLES_TEAM = 'ls_payables';

// The ops teams — each holds its own loadsmart.* permission (see db/role-catalog.ts).
export const LOADSMART_TEAM_ROLES = [
  APPROVAL_TEAM,
  PLACEMENT_TEAM,
  TRACKING_TEAM,
  CS_TEAM,
  RECEIVABLES_TEAM,
  PAYABLES_TEAM,
] as const;

// Every team a platform admin may put a team member in (POST /admin/staff) — deliberately excludes
// platform_admin (seed-only owner) and org_admin (self-signup only).
export const STAFF_TEAMS = [ADMIN_TEAM, ...LOADSMART_TEAM_ROLES, SALES_ROLE] as const;
export type StaffTeam = (typeof STAFF_TEAMS)[number];
export const STAFF_ASSIGNABLE_ROLES: readonly string[] = STAFF_TEAMS;

// Teams whose members may be assigned an organization's KYC review (online verifier / physical
// agent) — Approval verifies onboarding documents (notes §5); Admin can do anything Approval can.
export const KYC_REVIEWER_TEAMS: readonly string[] = [APPROVAL_TEAM, ADMIN_TEAM];

// The member's Role (users.team_role) — the design's Add team member form: Team member, Salesperson,
// ASM or Super Admin (named Admin here). The Role picks the team: a Team member chooses one ops
// team; Salesperson/ASM are the sales team; Admin is the Admin team. No access effect beyond the
// team — the team decides access. ASM is sales-only, so it can't sit on an ops team (design note:
// "Rohit Varma is on Tracking with the role ASM").
export const TEAM_MEMBER_TEAM_ROLE = 'team_member';
export const SALESPERSON_TEAM_ROLE = 'salesperson';
export const ASM_TEAM_ROLE = 'asm';
export const ADMIN_TEAM_ROLE = 'admin';
export const TEAM_ROLES: Record<StaffTeam, readonly string[]> = {
  [ADMIN_TEAM]: [ADMIN_TEAM_ROLE],
  [APPROVAL_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [PLACEMENT_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [TRACKING_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [CS_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [RECEIVABLES_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [PAYABLES_TEAM]: [TEAM_MEMBER_TEAM_ROLE],
  [SALES_ROLE]: [SALESPERSON_TEAM_ROLE, ASM_TEAM_ROLE],
};
export const ALL_TEAM_ROLES = [...new Set(Object.values(TEAM_ROLES).flat())];

// Sales-type members only: which side they sell to (notes §4 "tracker-sales vs shipper-sales").
export const SALES_TYPES = ['shipper_sales', 'tracker_sales'] as const;
export type SalesType = (typeof SALES_TYPES)[number];

// Permission-key prefixes that make up a team's identity — never granted directly to a staff member
// on top of their team (strictly one team per person, notes §4); see role.service.ts's
// grantPermission. Kept here, not in permissions.ts, whose every export must be a seeded key.
export const TEAM_PERMISSION_PREFIXES = ['loadsmart.', 'kyc.'] as const;
export function isTeamPermissionKey(key: string): boolean {
  return TEAM_PERMISSION_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isStaffTeam(role: string): role is StaffTeam {
  return (STAFF_TEAMS as readonly string[]).includes(role);
}

// Every role with scope: 'platform' in auth.roles — i.e. never tied to a tenant (tenantId is
// always null for these). Used by tenant-scope.middleware.ts to exempt them from requiring a
// tenantId; NOT used by requirePermission's bypass, which stays platform_admin-only on purpose —
// staff roles get exactly the permissions their role_permissions row grants, no superuser bypass.
export const PLATFORM_SCOPE_ROLES = [PLATFORM_ADMIN_ROLE, ...STAFF_ASSIGNABLE_ROLES];

// Named individually so listOrganizationUsers/inviteOrganizationUser can validate an assignment
// target without comparing against a raw string literal — same reason SALES_ROLE and the team
// are named above. Display labels (Settings → Users & Roles): "Sales / CS", "Dispatch",
// "Documents / Ops", "Finance / Accounts" — the frontend's concern, not encoded here.
export const SALES_CS_ROLE = 'sales_cs';
export const DISPATCH_ROLE = 'dispatch';
export const DOCUMENTS_OPS_ROLE = 'documents_ops';
export const FINANCE_ACCOUNTS_ROLE = 'finance_accounts';

// Roles an org admin may hand a teammate invited into their own org (POST
// /auth/organization/users) — deliberately excludes org_admin itself (provisioned exclusively
// through self-signup, same reasoning STAFF_ASSIGNABLE_ROLES excludes platform_admin/org_admin).
export const ORG_ASSIGNABLE_ROLES = [
  SALES_CS_ROLE,
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
];

export type Role = string;
