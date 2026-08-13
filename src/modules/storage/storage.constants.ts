// Each purpose maps to exactly one S3 key prefix and its own size/mime-type policy — the module's
// single source of truth for what's allowed to be uploaded and where it lands in the bucket.
export const UPLOAD_PURPOSES = [
  'kyc',
  'trips/pod',
  'trips/lr',
  'masters/vehicle',
  'profile',
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
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'trips/pod',
  },
  'trips/lr': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf'],
    keyPrefix: 'trips/lr',
  },
  'masters/vehicle': {
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    keyPrefix: 'masters/vehicle',
  },
  profile: {
    maxSizeBytes: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    keyPrefix: 'profile',
  },
};

// Both presigned-URL kinds are pure local signing (no network round trip to S3), so a short
// expiry costs nothing in latency — it just limits how long a leaked URL stays useful.
export const PRESIGNED_POST_EXPIRY_SECONDS = 5 * 60;
export const DOWNLOAD_URL_EXPIRY_SECONDS = 5 * 60;

// Default threshold for purgeStalePending — not enforced by any scheduler yet (see
// storage.service.ts), just the intended value for whenever one gets built.
export const STALE_PENDING_MINUTES = 24 * 60;
