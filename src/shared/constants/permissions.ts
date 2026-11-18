// Named constants for the permission keys route guards actually check — mirrors roles.ts's
// existing pattern. Must match the `key` values inserted by db/seed-roles.ts exactly — enforced
// at server startup, not just convention: see assert-permissions-seeded.ts, called from
// server.ts's bootstrap(). A constant added here with no matching seed row fails the server at
// boot with a clear error, rather than silently 403ing everyone on whatever route uses it.

export const ADMIN_ORGANIZATIONS_MANAGE = 'admin.organizations.manage';
export const ORGANIZATION_PROFILE_MANAGE = 'organization.profile.manage';
export const MASTERS_WRITE = 'masters.write';

// Not referenced by any requirePermission(...) call yet — seeded onto the sales and ops
// team roles so those roles have a meaningful starting bundle ahead of the
// modules that will eventually enforce them.
export const KYC_ONLINE_VERIFY = 'kyc.online.verify';
export const KYC_ONLINE_REJECT = 'kyc.online.reject';
export const KYC_OFFLINE_VERIFY = 'kyc.offline.verify';
export const KYC_OFFLINE_REJECT = 'kyc.offline.reject';
// Admin-team only: see every organization in the KYC queue (not just ones assigned to you), act on
// any of them, and assign/reassign reviewers — the notes' "Super Admin — everything".
export const KYC_OVERSEE = 'kyc.oversee';
export const LOADS_CONSOLE_ACCESS = 'loads.console.access';
export const SALES_LEADS_MANAGE = 'sales.leads.manage';

// Same "not yet enforced anywhere" situation as the KYC_*/LOADS_CONSOLE_ACCESS/SALES_LEADS_MANAGE
// block above — seeded onto the 4 org-invitable teammate roles (see db/seed-roles.ts,
// shared/constants/roles.ts's ORG_ASSIGNABLE_ROLES) ahead of the Load module and
// Payments module that will eventually enforce them, so an invited teammate has a
// meaningful starting bundle instead of an empty one.
export const REQUISITIONS_MANAGE = 'requisitions.manage'; // sales_cs — Requisition stage
export const LOADS_POST = 'loads.post'; // Post a load form — post, save drafts, manage indent contracts
export const DISPATCH_PLANNING_MANAGE = 'dispatch.planning.manage'; // dispatch — Planning/Assignment
export const LOADS_DOCUMENTS_MANAGE = 'loads.documents.manage'; // documents_ops — Loading/E-POD
export const PAYMENTS_MANAGE = 'payments.manage'; // finance_accounts — Advance/Balance
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
// Mark a truck verified by hand when VAHAN can't be reached — the fleet truck and a load's truck
// check. Org admin only.
export const TRUCK_VERIFY_MANUAL = 'trucks.verify_manual';
// Mark a load's driver licence verified by hand when Sarathi can't confirm it. Org admin only.
export const DRIVER_VERIFY_MANUAL = 'drivers.verify_manual';

// Maintenance (FMS-MNT-000). MANAGE gates every workshop write (log a service, open/close a
// breakdown, tyres, batteries). COSTS_VIEW is not a route gate: the maintenance screen's reads are
// open to every tenant seat, and this key only decides whether the money on it — spend and
// downtime headlines, job costs — is included (see maintenance/utils/cost-visibility.ts).
export const MAINTENANCE_MANAGE = 'maintenance.manage';
export const MAINTENANCE_COSTS_VIEW = 'maintenance.costs.view';

// Geofences (Tracking → Geofences): create/edit/delete a geofence and feed it location pings.
// Reads are open to every tenant seat, same as maintenance.
export const GEOFENCES_MANAGE = 'geofences.manage';

// Settings → Notifications, organization tab: change or reset the org-wide notification
// preferences and quiet hours. A user's own preferences need no key.
export const NOTIFICATION_PREFERENCES_MANAGE = 'notifications.preferences.manage';

// LS_N_0012 — receives "vehicle could not be verified on Vahan" alerts. Assigned to no role by
// default (db/seed-roles.ts); an org admin grants it to specific teammates via the existing
// POST /roles/users/:userId/permissions.
export const COMPLIANCE_MANAGE = 'compliance.manage';
// Notification audience only (no route checks it) — who gets trip alerts such as LS_N_0016 truck
// assigned and LS_N_0017 assignment blocked on compliance (the LS_N sheet's "trip.track").
export const TRIP_TRACK = 'trip.track';

// Loadsmart ops console (loadsmart-ops/) — keys grouped into team bundles in db/role-catalog.ts.
// Platform scope. A key is not a team: e.g. Placement holds LS_PLACEMENT + LS_MARGIN_VIEW, and the
// Admin team holds every one of them.
// The Approval team is the KYC desks (online_kyc_desk / offline_kyc_desk hold LS_APPROVAL).
export const LS_APPROVAL = 'loadsmart.approval'; // reviews shippers, posts a load for a shipper
export const LS_PLACEMENT = 'loadsmart.placement'; // sourcing, Loadsmart's price, truck, memo
export const LS_TRACKING = 'loadsmart.tracking'; // papers, e-LR, charges, advance, POD decision
export const LS_CS = 'loadsmart.cs'; // claims on loads delivered with issues, tickets
export const LS_RECEIVABLES = 'loadsmart.receivables'; // shipper invoice and payment verification
export const LS_PAYABLES = 'loadsmart.payables'; // carrier advance and balance, original POD
// Super Admin — in no role's bundle: platform_admin passes through its bypass, and a platform
// admin can grant either key to a named person (POST /roles/users/:userId/permissions).
export const LS_MONEY_APPROVE = 'loadsmart.money.approve'; // approves money going out (S01)
export const LS_SETTINGS_MANAGE = 'loadsmart.settings.manage'; // Super Admin → Settings (S03)
// Admin-team only (notes §11: "Admin — everything, including Masters (brokers etc.) — no other
// team needs Masters access"): create/edit partners (brokers) in the ops console.
export const LS_MASTERS_MANAGE = 'loadsmart.masters.manage';
// Sees Loadsmart's margin on a load or a shipper's terms (notes §7: "margin figures stay
// Admin/Placement-only"). Without it, marginPercent is stripped from ops responses.
export const LS_MARGIN_VIEW = 'loadsmart.margin.view';
// Admin-team only: change a shipper's margin (PUT /terms) or override it when approving a load.
// Separate from LS_MARGIN_VIEW — Placement sees margin but must not change a shipper's terms.
export const LS_MARGIN_MANAGE = 'loadsmart.margin.manage';
// The same manual truck check on a Loadsmart load — Admin team only.
export const LS_TRUCK_VERIFY_MANUAL = 'loadsmart.truck.verify_manual';
// The same manual licence check on a Loadsmart load — Admin team only.
export const LS_DRIVER_VERIFY_MANUAL = 'loadsmart.driver.verify_manual';
