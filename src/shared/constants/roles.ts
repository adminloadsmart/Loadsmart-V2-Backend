// Roles are now a fixed, seeded catalog in auth.roles (see db/seed-roles.ts), not a closed
// compile-time set — Role is just a name string. These two constants survive because they're
// still referenced by name in code: requirePermission's platform_admin bypass, role.service.ts's
// assertCanManage, and auth.service.ts's verifyOtp bootstrap assignment.
export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const ORG_ADMIN_ROLE = 'org_admin';
// Named individually (also members of STAFF_ASSIGNABLE_ROLES below) so admin.service.ts's
// online-verifier/physical-agent assignment can validate an assignment target actually holds the
// matching role, without comparing against a raw string literal.
export const ONLINE_KYC_DESK_ROLE = 'online_kyc_desk';
export const OFFLINE_KYC_DESK_ROLE = 'offline_kyc_desk';
// Named individually so admin.service.ts's referral-code owner assignment can validate the owner
// actually holds this role, without comparing against a raw string literal — same reason
// ONLINE_KYC_DESK_ROLE/OFFLINE_KYC_DESK_ROLE exist.
export const SALES_ROLE = 'sales';
export const LOAD_CONSOLE = 'load_console';

// Roles a platform admin may hand a newly-created staff account (POST /admin/staff) — deliberately
// excludes platform_admin (no minting new platform admins through a bulk staff form) and org_admin
// (provisioned exclusively through self-signup).
export const STAFF_ASSIGNABLE_ROLES = [
  SALES_ROLE,
  ONLINE_KYC_DESK_ROLE,
  OFFLINE_KYC_DESK_ROLE,
  LOAD_CONSOLE,
];

// Every role with scope: 'platform' in auth.roles — i.e. never tied to a tenant (tenantId is
// always null for these). Used by tenant-scope.middleware.ts to exempt them from requiring a
// tenantId; NOT used by requirePermission's bypass, which stays platform_admin-only on purpose —
// staff roles get exactly the permissions their role_permissions row grants, no superuser bypass.
export const PLATFORM_SCOPE_ROLES = [PLATFORM_ADMIN_ROLE, ...STAFF_ASSIGNABLE_ROLES];

// Named individually so listOrganizationUsers/inviteOrganizationUser can validate an assignment
// target without comparing against a raw string literal — same reason ONLINE_KYC_DESK_ROLE etc.
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
