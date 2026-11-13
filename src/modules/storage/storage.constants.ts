import {
  KYC_OFFLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_ONLINE_VERIFY,
  LOADS_CONSOLE_ACCESS,
  LS_APPROVAL,
  LS_CS,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_POD,
  LS_RECEIVABLES,
  LS_TRACKING,
  LS_VERIFICATION,
} from '../../shared/constants/permissions';

// Each purpose maps to exactly one S3 key prefix and its own size/mime-type policy — the module's
// single source of truth for what's allowed to be uploaded and where it lands in the bucket.
export const UPLOAD_PURPOSES = [
  'kyc',
  'trips/pod',
  'trips/lr',
  'masters/vehicle',
  'masters/driver',
  'organizations/shopboard-premises',
  'profile',
  'driver/profile',
  'loads/invoice',
  'loads/eway-bill',
  'loads/payment-proof',
  'loads/issue',
  'maintenance/invoice',
  'loads/loading-photo',
  'loads/weighing-slip',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export interface UploadPolicy {
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  keyPrefix: string;
}

export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
  kyc: {
    maxSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'kyc',
  },
  'trips/pod': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'trips/pod',
  },
  'trips/lr': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'trips/lr',
  },
  'masters/vehicle': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'masters/vehicle',
  },
  // Driving-licence front/back photos captured on the manual Sarathi route — see
  // DRIVER_DOCUMENT_TYPES in driver/drivers.types.ts. Purpose key itself ('masters/driver')
  // stays as-is — it's a storage.files_purpose_enum DB value, unrelated to driver's module path.
  'masters/driver': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'masters/driver',
  },
  // Photograph of the organization's physical shop board/premises, supplied after the
  // organization application itself has been submitted for KYC.
  'organizations/shopboard-premises': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
    keyPrefix: 'organizations/shopboard-premises',
  },
  profile: {
    maxSizeBytes: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'profile',
  },
  // Driver-app profile photo — see driver-portal.service.ts's updateMyProfile. Uploaded tenant-less
  // via driver-portal's own POST /files.
  'driver/profile': {
    maxSizeBytes: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'driver/profile',
  },
  // `trips/pod`/`trips/lr` above for E-POD/E-LR, already at the same 5MB limit.
  'loads/invoice': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    keyPrefix: 'loads/invoice',
  },
  'loads/eway-bill': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    keyPrefix: 'loads/eway-bill',
  },
  // Optional screenshot attached to an advance/balance payment record (PRD §6.6).
  'loads/payment-proof': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'loads/payment-proof',
  },
  // Driver-app "Report An Issue" photos — see load-issue.service.ts. Reachable via
  // driver-portal's own POST /files (not this module's staff-only routes), same as trips/pod.
  'loads/issue': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'loads/issue',
  },
  // Invoice / work order attached to Log a service and Record Tyre Maintenance.
  'maintenance/invoice': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'maintenance/invoice',
  },
  // Non-mandatory Loading Confirmation uploads — see load.service.ts's confirmLoading. Reachable
  // via driver-portal's own POST /files, same as trips/pod and loads/issue.
  'loads/loading-photo': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'loads/loading-photo',
  },
  'loads/weighing-slip': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    keyPrefix: 'loads/weighing-slip',
  },
};

// Both presigned-URL kinds are pure local signing (no network round trip to S3), so a short
// expiry costs nothing in latency — it just limits how long a leaked URL stays useful.
export const PRESIGNED_POST_EXPIRY_SECONDS = 5 * 60;
export const DOWNLOAD_URL_EXPIRY_SECONDS = 5 * 60;

// Default threshold for purgeStalePending — not enforced by any scheduler yet (see
// storage.service.ts), just the intended value for whenever one gets built.
export const STALE_PENDING_MINUTES = 24 * 60;

/**
 * Which other tenants' files a tenant-less platform-scope caller may read, by what it does
 * (any of `permissions`) and what the file is (`purposes`). platform_admin reads everything; any
 * other staff caller not matched here reads only files it uploaded itself.
 */
export const STAFF_CROSS_TENANT_READS: readonly {
  permissions: readonly string[];
  purposes: readonly UploadPurpose[];
}[] = [
  // KYC desks review organization onboarding documents.
  {
    permissions: [KYC_ONLINE_VERIFY, KYC_ONLINE_REJECT, KYC_OFFLINE_VERIFY, KYC_OFFLINE_REJECT],
    purposes: ['kyc', 'organizations/shopboard-premises', 'profile'],
  },
  // The Loadsmart ops console works shippers' loads and trips.
  {
    permissions: [
      LOADS_CONSOLE_ACCESS,
      LS_APPROVAL,
      LS_PLACEMENT,
      LS_VERIFICATION,
      LS_TRACKING,
      LS_POD,
      LS_CS,
      LS_RECEIVABLES,
      LS_PAYABLES,
    ],
    purposes: UPLOAD_PURPOSES.filter(
      (purpose) => purpose.startsWith('loads/') || purpose.startsWith('trips/'),
    ),
  },
];
