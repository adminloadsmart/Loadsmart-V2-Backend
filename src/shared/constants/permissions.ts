// Named constants for the permission keys route guards actually check — mirrors roles.ts's
// existing pattern. Must match the `key` values inserted by db/seed-roles.ts exactly — enforced
// at server startup, not just convention: see assert-permissions-seeded.ts, called from
// server.ts's bootstrap(). A constant added here with no matching seed row fails the server at
// boot with a clear error, rather than silently 403ing everyone on whatever route uses it.

export const ADMIN_ORGANIZATIONS_MANAGE = 'admin.organizations.manage';
export const ORGANIZATION_PROFILE_MANAGE = 'organization.profile.manage';
export const MASTERS_WRITE = 'masters.write';

// Not referenced by any requirePermission(...) call yet — seeded onto sales/online_kyc_desk/
// offline_kyc_desk/load_console so those roles have a meaningful starting bundle ahead of the
// modules that will eventually enforce them.
export const KYC_ONLINE_VERIFY = 'kyc.online.verify';
export const KYC_ONLINE_REJECT = 'kyc.online.reject';
export const KYC_OFFLINE_VERIFY = 'kyc.offline.verify';
export const KYC_OFFLINE_REJECT = 'kyc.offline.reject';
export const LOADS_CONSOLE_ACCESS = 'loads.console.access';
export const SALES_LEADS_MANAGE = 'sales.leads.manage';

// Same "not yet enforced anywhere" situation as the KYC_*/LOADS_CONSOLE_ACCESS/SALES_LEADS_MANAGE
// block above — seeded onto the 4 org-invitable teammate roles (see db/seed-roles.ts,
// shared/constants/roles.ts's ORG_ASSIGNABLE_ROLES) ahead of the Load module and
// Payments module that will eventually enforce them, so an invited teammate has a
// meaningful starting bundle instead of an empty one.
export const REQUISITIONS_MANAGE = 'requisitions.manage'; // sales_cs — Requisition stage
export const DISPATCH_PLANNING_MANAGE = 'dispatch.planning.manage'; // dispatch — Planning/Assignment
export const LOADS_DOCUMENTS_MANAGE = 'loads.documents.manage'; // documents_ops — Loading/E-POD
export const PAYMENTS_MANAGE = 'payments.manage'; // finance_accounts — Advance/Balance
export const SETTLEMENTS_MANAGE = 'settlements.manage'; // finance_accounts — Transporter settlement payouts
export const CUSTOMERS_CREATE = 'customers.create';
export const CUSTOMERS_READ = 'customers.read';
export const CUSTOMERS_WRITE = 'customers.write';
export const CUSTOMERS_APPROVE = 'customers.approve';
export const FILES_UPLOAD = 'storage.files.upload';
export const FILES_READ = 'storage.files.read';
export const FILES_DELETE = 'storage.files.delete';

// Approve/reject a pending vehicle or driver created by a non-org-admin (currently: dispatch).
// Org_admin only — same one-key-per-module shape as MASTERS_WRITE, not split per entity.
export const MASTERS_APPROVE = 'masters.approve';
