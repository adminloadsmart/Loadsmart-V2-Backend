/* Service-layer inputs — shapes accepted by AuthService's methods. */

export interface SignupInput {
  phoneNumber: string;
}

export interface RequestLoginOtpInput {
  phoneNumber: string;
  portal: LoginPortal;
}

export type LoginPortal = 'organization' | 'platform';

export type DevicePlatform = 'ios' | 'android' | 'web';

// Optional on every session-issuing input below — a client sends these when it has an FCM token
// to register (deviceType is required alongside fcmToken at the validator layer, see
// auth.validators.ts); omitted entirely for clients (e.g. plain web) with nothing to register.
// ipAddress is never client-supplied — always derived server-side from req.ip.
export interface DeviceCaptureInput {
  fcmToken?: string;
  deviceType?: DevicePlatform;
  deviceInfo?: string;
  ipAddress?: string | null;
}

export interface VerifyOtpInput extends DeviceCaptureInput {
  phoneNumber: string;
  otp: string;
}

export interface VerifyLoginOtpInput extends DeviceCaptureInput {
  phoneNumber: string;
  otp: string;
  portal: LoginPortal;
}

export interface SaveUserDetailsInput {
  name: string;
  email?: string;
  password?: string;
  designation?:
    | 'Owner'
    | 'Logistics Manager'
    | 'Factory Manager'
    | 'Dispatch Manager'
    | 'Accounts'
    | 'Administration manager'
    | 'Others';
  manualDesignation?: string;
  department?: 'Sales' | 'Logistics' | 'Dispatch' | 'Accounts' | 'Administration' | 'Management';
}

export interface CreateStaffInput {
  fullName: string;
  phoneNumber: string;
  email?: string;
  roleId: string;
  coverage: string;
  // Extra permissions granted on top of whatever roleId already grants — see
  // auth.service.ts's createStaffUser.
  permissionIds?: string[];
}

export interface UpdateStaffInput {
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  roleId?: string;
  coverage?: string;
  // Extra permissions granted on top of whatever roleId already grants — see
  // auth.service.ts's createStaffUser.
  permissionIds?: string[];
}

// Org admin inviting a teammate into their own org — the organization-scope counterpart to
// CreateStaffInput. Phone only, no email: see auth.service.ts's inviteOrganizationUser.
export interface InviteOrganizationUserInput {
  fullName: string;
  phoneNumber: string;
  roleId: string;
}

export interface ListOrganizationUsersInput {
  search?: string;
  role?: string;
  page: number;
  limit: number;
}

export interface LoginInput extends Omit<DeviceCaptureInput, 'ipAddress'> {
  phoneNumber: string;
  password: string;
  portal: LoginPortal;
}

export interface RefreshInput {
  refreshToken: string;
  portal: LoginPortal;
}

export interface LogoutInput {
  // All three come from req.user (a verified JWT claim), never the request body — logout takes
  // no body at all. sid identifies the exact refresh-token row to revoke; jti/exp are for
  // immediately blocklisting this access token (see shared/utils/token-blocklist.ts).
  sid?: string;
  jti?: string;
  exp?: number;
}

export interface CreatePasswordInput {
  password: string;
  confirmPassword: string;
}
