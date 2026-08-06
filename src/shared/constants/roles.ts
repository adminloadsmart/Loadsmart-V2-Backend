// Roles are now a fixed, seeded catalog in auth.roles (see db/seed-roles.ts), not a closed
// compile-time set — Role is just a name string. These two constants survive because they're
// still referenced by name in code: requirePermission's platform_admin bypass, role.service.ts's
// assertCanManage, and auth.service.ts's verifyOtp bootstrap assignment.
export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const ORG_ADMIN_ROLE = 'org_admin';

// Roles a platform admin may hand a newly-created staff account (POST /admin/staff) — deliberately
// excludes platform_admin (no minting new platform admins through a bulk staff form) and org_admin
// (provisioned exclusively through self-signup).
export const STAFF_ASSIGNABLE_ROLES = ['sales', 'online_kyc_desk', 'offline_kyc_desk', 'load_console'];

// Every role with scope: 'platform' in auth.roles — i.e. never tied to a tenant (tenantId is
// always null for these). Used by tenant-scope.middleware.ts to exempt them from requiring a
// tenantId; NOT used by requirePermission's bypass, which stays platform_admin-only on purpose —
// staff roles get exactly the permissions their role_permissions row grants, no superuser bypass.
export const PLATFORM_SCOPE_ROLES = [PLATFORM_ADMIN_ROLE, ...STAFF_ASSIGNABLE_ROLES];

export type Role = string;
