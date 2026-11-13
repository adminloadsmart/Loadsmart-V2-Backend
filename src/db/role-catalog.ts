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
  MAINTENANCE_MANAGE,
  MAINTENANCE_COSTS_VIEW,
  COMPLIANCE_MANAGE,
  TRIP_TRACK,
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_VERIFICATION,
  LS_TRACKING,
  LS_POD,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
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
  // Loadsmart ops console — one per ops team (loadsmart-ops/).
  ...[
    [LS_APPROVAL, 'Check Loadsmart loads and post them on the load board'],
    [LS_PLACEMENT, "Record partner bids, send Loadsmart's bid and name the partner's driver"],
    [LS_VERIFICATION, 'Approve the truck and driver on a Loadsmart load'],
    [LS_TRACKING, 'See Loadsmart loads on the road (the shipper runs the trip)'],
    [LS_POD, 'Rate shipper and partner and receive the original POD'],
    [LS_CS, 'See claims on Loadsmart loads delivered with issues (the shipper settles them)'],
    [LS_RECEIVABLES, "See Loadsmart's invoices and the shipper's payments"],
    [LS_PAYABLES, "Pay the partner's advance and balance"],
  ].map(([key, description]) => ({
    key,
    module: 'loadsmart',
    scope: 'platform' as PermissionScope,
    description,
  })),
];

const LOADSMART_PERMISSIONS = [
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_VERIFICATION,
  LS_TRACKING,
  LS_POD,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
];

// role name -> permission keys. platform_admin gets none: its bypass is code-level
// (require-permission.middleware.ts), not data, so this list never needs updating when a new
// permission key is added.
export const ROLES: { name: string; scope: RoleScope; permissionKeys: string[] }[] = [
  { name: PLATFORM_ADMIN_ROLE, scope: 'platform', permissionKeys: [] },
  {
    name: 'sales',
    scope: 'platform',
    permissionKeys: [SALES_LEADS_MANAGE, CUSTOMERS_CREATE, FILES_READ, FILES_UPLOAD],
  },
  {
    name: 'online_kyc_desk',
    scope: 'platform',
    permissionKeys: [KYC_ONLINE_VERIFY, KYC_ONLINE_REJECT, FILES_READ, FILES_UPLOAD],
  },
  {
    name: 'offline_kyc_desk',
    scope: 'platform',
    permissionKeys: [KYC_OFFLINE_VERIFY, KYC_OFFLINE_REJECT, FILES_READ, FILES_UPLOAD],
  },
  {
    name: 'load_console',
    scope: 'platform',
    permissionKeys: [LOADS_CONSOLE_ACCESS, FILES_READ, FILES_UPLOAD, ...LOADSMART_PERMISSIONS],
  },
  // One role per Loadsmart ops team — its own key plus console access and files.
  ...(
    [
      ['ls_approval', LS_APPROVAL],
      ['ls_placement', LS_PLACEMENT],
      ['ls_verification', LS_VERIFICATION],
      ['ls_tracking', LS_TRACKING],
      ['ls_pod', LS_POD],
      ['ls_cs', LS_CS],
      ['ls_receivables', LS_RECEIVABLES],
      ['ls_payables', LS_PAYABLES],
    ] as const
  ).map(([name, key]) => ({
    name,
    scope: 'platform' as RoleScope,
    permissionKeys: [key, LOADS_CONSOLE_ACCESS, FILES_READ, FILES_UPLOAD],
  })),
  {
    name: ORG_ADMIN_ROLE,
    scope: 'organization',
    permissionKeys: [
      ORGANIZATION_PROFILE_MANAGE,
      MASTERS_WRITE,
      MASTERS_APPROVE,
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
  // module" situation as sales/online_kyc_desk/offline_kyc_desk/load_console above.
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
