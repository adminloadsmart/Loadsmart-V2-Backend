/* Service-layer inputs for the driver-app auth/session layer — a deliberately separate identity
 * domain from modules/auth/'s auth.types.ts (see docs/driver-auth.md). Shapes mirror auth.types.ts
 * where the concept is the same (device capture), but nothing here imports from modules/auth/. */

export type DriverDevicePlatform = 'ios' | 'android' | 'web';

// Optional on every session-issuing input below — same convention as auth.types.ts's
// DeviceCaptureInput. ipAddress is never client-supplied — always derived server-side from req.ip.
export interface DriverDeviceCaptureInput {
  fcmToken?: string;
  deviceType?: DriverDevicePlatform;
  deviceInfo?: string;
  ipAddress?: string | null;
}

export interface RequestDriverOtpInput {
  phoneNumber: string;
}

// A driver profile is now global (one row per phone), so /otp/request no longer needs to fan out
// across multiple tenant-scoped rows — the ambiguity that's left is *which of the driver's active
// tenant relations* to sign into, resolved at /otp/verify time instead. See driver-auth.service.ts.
export interface DriverLoginCandidate {
  tenantId: string;
  driverTenantRelationId: string;
}

export interface VerifyDriverOtpInput extends DriverDeviceCaptureInput {
  phoneNumber: string;
  otp: string;
  driverId: string;
}

export interface SelectDriverTenantInput extends DriverDeviceCaptureInput {
  driverId: string;
  tenantId: string;
  candidates: DriverLoginCandidate[];
}

export interface DriverRefreshInput {
  refreshToken: string;
}

export interface DriverLogoutInput {
  // All three come from req.driver (a verified JWT claim), never the request body — same
  // convention as auth.types.ts's LogoutInput.
  sid?: string;
  jti?: string;
  exp?: number;
}

export interface SelectDriverRelationInput {
  driverId: string;
  relationId: string;
  device?: DriverDeviceCaptureInput;
}
