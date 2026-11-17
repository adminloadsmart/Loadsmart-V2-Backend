// The fixed roles/permissions catalog — pure data, no database access, so tests can import it
// (db/seed-roles.ts runs the seed on import). db/seed-roles.ts upserts exactly this into
// auth.permissions / auth.roles / auth.role_permissions on every deploy.

import type { PermissionScope } from '../modules/roles/entities/permission.entity';
import type { RoleScope } from '../modules/roles/entities/role.entity';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  ORGANIZATION_PROFILE_MANAGE,
  MASTERS_WRITE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
  KYC_OVERSEE,
  LOADS_CONSOLE_ACCESS,
  SALES_LEADS_MANAGE,
  REQUISITIONS_MANAGE,
  LOADS_POST,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  PAYMENTS_MANAGE,
  CUSTOMERS_CREATE,
  CUSTOMERS_READ,
  CUSTOMERS_WRITE,
  CUSTOMERS_APPROVE,
  FILES_UPLOAD,
  FILES_READ,
  FILES_DELETE,
  MASTERS_APPROVE,
  TRUCK_VERIFY_MANUAL,
  MAINTENANCE_MANAGE,
  MAINTENANCE_COSTS_VIEW,
  COMPLIANCE_MANAGE,
  TRIP_TRACK,
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_TRACKING,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
  LS_MASTERS_MANAGE,
  LS_MARGIN_VIEW,
  LS_MARGIN_MANAGE,
  LS_TRUCK_VERIFY_MANUAL,
  GEOFENCES_MANAGE,
  NOTIFICATION_PREFERENCES_MANAGE,
} from '../shared/constants/permissions';
import {
  PLATFORM_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
  SALES_CS_ROLE,
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
  SALES_ROLE,
  ADMIN_TEAM,
  APPROVAL_TEAM,
  PLACEMENT_TEAM,
  TRACKING_TEAM,
  CS_TEAM,
  RECEIVABLES_TEAM,
  PAYABLES_TEAM,
} from '../shared/constants/roles';

export const PERMISSIONS: {
  key: string;
  module: string;
  scope: PermissionScope;
  description: string;
}[] = [
  {
    key: ADMIN_ORGANIZATIONS_MANAGE,
    module: 'admin',
    scope: 'platform',
    description: 'Manage organizations across all tenants',
  },
  {
    key: ORGANIZATION_PROFILE_MANAGE,
    module: 'auth',
    scope: 'organization',
    description: "Create/update the caller's own organization profile",
  },
  {
    key: MASTERS_WRITE,
    module: 'masters',
    scope: 'organization',
    description: 'Create/update/delete vehicles, drivers, and their documents',
  },
  {
    key: KYC_ONLINE_VERIFY,
    module: 'onboarding',
    scope: 'platform',
    description: 'Verify KYC submitted online',
  },
  {
    key: KYC_ONLINE_REJECT,
    module: 'onboarding',
    scope: 'platform',
    description: 'Reject KYC submitted online',
  },
  {
    key: KYC_OFFLINE_VERIFY,
    module: 'onboarding',
    scope: 'platform',
    description: 'Verify KYC submitted offline',
  },
  {
    key: KYC_OFFLINE_REJECT,
    module: 'onboarding',
    scope: 'platform',
    description: 'Reject KYC submitted offline',
  },
  {
    key: KYC_OVERSEE,
    module: 'onboarding',
    scope: 'platform',
    description: 'See every organization in the KYC queue and assign reviewers',
  },
  {
    key: LOADS_CONSOLE_ACCESS,
    module: 'dispatch',
    scope: 'platform',
    description: 'Access the load console',
  },
  {
    key: SALES_LEADS_MANAGE,
    module: 'sales',
    scope: 'platform',
    description: 'Manage sales leads',
  },
  {
    key: REQUISITIONS_MANAGE,
    module: 'loads',
    scope: 'organization',
    description: 'Manage load requisitions',
  },
  {
    key: LOADS_POST,
    module: 'loads',
    scope: 'organization',
    description: 'Post loads to the market, a contracted transporter or own fleet',
  },
  {
    key: DISPATCH_PLANNING_MANAGE,
    module: 'loads',
    scope: 'organization',
    description: 'Manage dispatch planning and load assignment',
  },
  {
    key: LOADS_DOCUMENTS_MANAGE,
    module: 'loads',
    scope: 'organization',
    description: 'Manage loading documents and E-POD',
  },
  {
    key: PAYMENTS_MANAGE,
    module: 'payments',
    scope: 'organization',
    description: 'Manage advance/balance payments',
  },
  {
    key: MAINTENANCE_MANAGE,
    module: 'maintenance',
    scope: 'organization',
    description: 'Log services, open/close breakdowns, record tyres and battery health',
  },
  {
    key: GEOFENCES_MANAGE,
    module: 'tracking',
    scope: 'organization',
    description: 'Create and edit geofences and submit vehicle location pings',
  },
  {
    key: NOTIFICATION_PREFERENCES_MANAGE,
    module: 'notifications',
    scope: 'organization',
    description: "Manage the organization's notification preferences and quiet hours",
  },
  {
    key: MAINTENANCE_COSTS_VIEW,
    module: 'maintenance',
    scope: 'organization',
    description: 'See maintenance spend, downtime cost and job costs',
  },
  {
    key: CUSTOMERS_CREATE,
    module: 'customers',
    scope: 'organization',
    description: 'Create customers',
  },
  {
    key: CUSTOMERS_READ,
    module: 'customers',
    scope: 'organization',
    description: 'Read customers',
  },
  {
    key: CUSTOMERS_WRITE,
    module: 'customers',
    scope: 'organization',
    description: 'Edit customers',
  },
  {
    key: CUSTOMERS_APPROVE,
    module: 'customers',
    scope: 'organization',
    description: 'Approve customers',
  },
  {
    key: FILES_UPLOAD,
    module: 'storage',
    scope: 'organization',
    description: 'Initiate and confirm file uploads',
  },
  {
    key: FILES_READ,
    module: 'storage',
    scope: 'organization',
    description: 'Read file metadata and obtain download URLs',
  },
  {
    key: FILES_DELETE,
    module: 'storage',
    scope: 'organization',
    description: 'Delete files',
  },
  {
    key: MASTERS_APPROVE,
    module: 'masters',
    scope: 'organization',
    description: 'Approve/reject vehicles and drivers created pending admin approval',
  },
  {
    key: TRUCK_VERIFY_MANUAL,
    module: 'masters',
    scope: 'organization',
    description: "Mark a truck verified by hand when VAHAN can't be reached",
  },
  // Not in any role's default bundle (see ROLES below) — granted per user by an org admin.
  {
    key: COMPLIANCE_MANAGE,
    module: 'masters',
    scope: 'organization',
    description: 'Get alerts when a vehicle registration cannot be verified on Vahan',
  },
  // Notification audience only — trip alerts (LS_N_0016/0017). In org_admin, dispatch and
  // documents_ops's default bundles below; an org admin can grant it to anyone else.
  {
    key: TRIP_TRACK,
    module: 'dispatch',
    scope: 'organization',
    description: 'Get trip alerts: truck assigned, or an assignment blocked by expired documents',
  },
  // Loadsmart ops console — one per ops team (loadsmart-ops/), plus Super Admin's two keys.
  ...[
    [LS_APPROVAL, "Review onboarded shippers and post a load on a shipper's behalf"],
    [
      LS_PLACEMENT,
      "Source trucks, give Loadsmart's price, add the truck and driver, send the memo",
    ],
    [LS_TRACKING, 'Run Loadsmart loads: papers, e-LR, charges, advance request, POD decision'],
    [LS_CS, 'Claims on Loadsmart loads delivered with issues, and tickets'],
    [LS_RECEIVABLES, "See Loadsmart's invoices and the shipper's payments"],
    [LS_PAYABLES, "Pay the carrier's advance and balance and track the original POD"],
    // Super Admin — in no role's bundle below; platform_admin passes through its bypass.
    [LS_MONEY_APPROVE, 'Approve money going out: carrier advances and balances'],
    [LS_SETTINGS_MANAGE, 'Change the Load module settings (timers, margin, advance, reason codes)'],
    [LS_MASTERS_MANAGE, 'Add and edit partners (brokers) — Admin team only'],
    [LS_MARGIN_VIEW, "See Loadsmart's margin on loads and shipper terms"],
    [LS_MARGIN_MANAGE, "Change a shipper's margin — Admin team only"],
    [
      LS_TRUCK_VERIFY_MANUAL,
      "Mark a Loadsmart load's truck verified by hand when VAHAN can't be reached — Admin team only",
    ],
  ].map(([key, description]) => ({
    key,
    module: 'loadsmart',
    scope: 'platform' as PermissionScope,
    description,
  })),
];

// Every staff team gets the ops console and file access on top of its own keys.
const STAFF_BASE = [LOADS_CONSOLE_ACCESS, FILES_READ, FILES_UPLOAD];

// Ops team bundles (16 Nov Figma notes §5–§11). A team is a bundle of keys, not one key:
//  - Approval verifies onboarding documents (§5) — so it holds the KYC review keys that used to
//    belong to the online/offline KYC desks.
//  - Placement verifies truck + DL before the Load Memo (§6) under LS_PLACEMENT, and sees margin
//    (§7: "margin stays Admin/Placement-only").
//  - Payables chases the original POD (§8) under LS_PAYABLES (/original-pod).
export const OPS_TEAM_BUNDLES: Record<string, string[]> = {
  [APPROVAL_TEAM]: [
    LS_APPROVAL,
    KYC_ONLINE_VERIFY,
    KYC_ONLINE_REJECT,
    KYC_OFFLINE_VERIFY,
    KYC_OFFLINE_REJECT,
  ],
  [PLACEMENT_TEAM]: [LS_PLACEMENT, LS_MARGIN_VIEW],
  [TRACKING_TEAM]: [LS_TRACKING],
  [CS_TEAM]: [LS_CS],
  [RECEIVABLES_TEAM]: [LS_RECEIVABLES],
  [PAYABLES_TEAM]: [LS_PAYABLES],
};

// The Admin team = every ops bundle combined (computed, so a key added to any team reaches Admin
// automatically) + the Admin-only keys (masters). Never ADMIN_ORGANIZATIONS_MANAGE: holding it makes
// isPlatformAdministrator() true, i.e. owner powers (staff/role/referral/org-status management).
// No sales keys either — Admin isn't a salesperson.
export const ADMIN_TEAM_ONLY_KEYS = [
  LS_MASTERS_MANAGE,
  LS_MARGIN_VIEW,
  LS_MARGIN_MANAGE,
  LS_TRUCK_VERIFY_MANUAL,
  KYC_OVERSEE,
  // Super Admin: the Admin team approves money going out and owns the Load module settings.
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
];
export const ADMIN_TEAM_BUNDLE = [
  ...new Set([...Object.values(OPS_TEAM_BUNDLES).flat(), ...ADMIN_TEAM_ONLY_KEYS]),
];

// role name -> permission keys. platform_admin gets none: its bypass is code-level
// (require-permission.middleware.ts), not data, so this list never needs updating when a new
// permission key is added.
export const ROLES: { name: string; scope: RoleScope; permissionKeys: string[] }[] = [
  { name: PLATFORM_ADMIN_ROLE, scope: 'platform', permissionKeys: [] },
  {
    name: SALES_ROLE,
    scope: 'platform',
    permissionKeys: [SALES_LEADS_MANAGE, CUSTOMERS_CREATE, FILES_READ, FILES_UPLOAD],
  },
  { name: ADMIN_TEAM, scope: 'platform', permissionKeys: [...ADMIN_TEAM_BUNDLE, ...STAFF_BASE] },
  ...Object.entries(OPS_TEAM_BUNDLES).map(([name, keys]) => ({
    name,
    scope: 'platform' as RoleScope,
    permissionKeys: [...keys, ...STAFF_BASE],
  })),
  {
    name: ORG_ADMIN_ROLE,
    scope: 'organization',
    permissionKeys: [
      ORGANIZATION_PROFILE_MANAGE,
      MASTERS_WRITE,
      MASTERS_APPROVE,
      TRUCK_VERIFY_MANUAL,
      CUSTOMERS_CREATE,
      CUSTOMERS_READ,
      CUSTOMERS_WRITE,
      CUSTOMERS_APPROVE,
      FILES_UPLOAD,
      FILES_READ,
      FILES_DELETE,
      // Load module — org_admin gets every stage's permission, same "full access to
      // every org-scoped module" treatment as MASTERS_*/CUSTOMERS_* above. Without these, the org
      // owner couldn't use their own organization's Load module once these gates went live —
      // sales_cs/dispatch/documents_ops/finance_accounts each get one of these individually below.
      REQUISITIONS_MANAGE,
      LOADS_POST,
      DISPATCH_PLANNING_MANAGE,
      LOADS_DOCUMENTS_MANAGE,
      PAYMENTS_MANAGE,
      MAINTENANCE_MANAGE,
      MAINTENANCE_COSTS_VIEW,
      TRIP_TRACK,
      GEOFENCES_MANAGE,
      NOTIFICATION_PREFERENCES_MANAGE,
    ],
  },
  // Teammate roles an org admin can invite (POST /auth/organization/users) — Settings → Users &
  // Roles. All 4 can request a new customer (CUSTOMERS_CREATE — customer.service.ts's create()
  // auto-approves for org_admin, leaves everyone else 'pending' for CUSTOMERS_APPROVE to review).
  // Only dispatch also gets MASTERS_WRITE: it's the sole non-admin role allowed to add a vehicle
  // or driver at all (masters.routes.ts's canWrite gate), same pending-approval treatment.
  // Beyond that, permission keys are forward-looking: the Load module and Payments
  // module that actually enforce them don't exist yet — same "seeded ahead of the
  // module" situation as sales above.
  {
    name: SALES_CS_ROLE,
    scope: 'organization',
    permissionKeys: [REQUISITIONS_MANAGE, LOADS_POST, CUSTOMERS_READ, FILES_READ, FILES_UPLOAD],
  },
  {
    name: DISPATCH_ROLE,
    scope: 'organization',
    permissionKeys: [
      DISPATCH_PLANNING_MANAGE,
      LOADS_POST,
      CUSTOMERS_CREATE,
      MASTERS_WRITE,
      // Books the workshop jobs (a breakdown is a dispatch event) but doesn't see what they cost.
      MAINTENANCE_MANAGE,
      TRIP_TRACK,
      GEOFENCES_MANAGE,
      FILES_READ,
      FILES_UPLOAD,
    ],
  },
  {
    name: DOCUMENTS_OPS_ROLE,
    scope: 'organization',
    permissionKeys: [
      LOADS_DOCUMENTS_MANAGE,
      TRIP_TRACK,
      CUSTOMERS_CREATE,
      FILES_READ,
      FILES_UPLOAD,
    ],
  },
  {
    name: FINANCE_ACCOUNTS_ROLE,
    scope: 'organization',
    permissionKeys: [
      PAYMENTS_MANAGE,
      MAINTENANCE_COSTS_VIEW,
      CUSTOMERS_CREATE,
      FILES_READ,
      FILES_UPLOAD,
    ],
  },
];
