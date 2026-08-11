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
export const CUSTOMERS_CREATE = 'customers.create';
export const CUSTOMERS_READ = 'customers.read';
export const CUSTOMERS_WRITE = 'customers.write';
export const CUSTOMERS_APPROVE = 'customers.approve';
