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

// One entry per active driver record across all tenants that matched the phone number at
// /otp/request time (masters.drivers' phone uniqueness is only per-tenant — see
// driver.repository.ts's findActiveDriversByPhone) — carried inside the short-lived
// driver-login-otp token between /otp/request and /otp/verify, and again inside
// driver-tenant-select if more than one candidate matched. See docs/driver-auth.md.
export interface DriverLoginCandidate {
  driverId: string;
  tenantId: string;
}

export interface VerifyDriverOtpInput extends DriverDeviceCaptureInput {
  phoneNumber: string;
  otp: string;
  candidates: DriverLoginCandidate[];
}

export interface SelectDriverTenantInput extends DriverDeviceCaptureInput {
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
