/* Service-layer inputs — shapes accepted by AuthService's methods. */

export interface SignupInput {
  phoneNumber: string;
}

export interface RequestLoginOtpInput {
  phoneNumber: string;
}

export interface VerifyOtpInput {
  phoneNumber: string;
  otp: string;
  password?: string;
}

export interface VerifyLoginOtpInput {
  phoneNumber: string;
  otp: string;
}

export interface SaveUserDetailsInput {
  name: string;
  email?: string;
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

export interface LoginInput {
  phoneNumber: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
  // The caller's own id (from req.user, never the request body) — logout must only ever revoke
  // the caller's own refresh token, not one they happen to be holding for another user.
  userId: string;
  jti?: string;
  exp?: number;
}

export interface CreatePasswordInput {
  password: string;
  confirmPassword: string;
}
