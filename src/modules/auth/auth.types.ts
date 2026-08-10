/* Service-layer inputs — shapes accepted by AuthService's methods. */

export interface SignupInput {
  phoneNumber: string;
}

export interface VerifyOtpInput {
  phoneNumber: string;
  otp: string;
}

export interface CreateStaffInput {
  fullName: string;
  phoneNumber: string;
  email: string;
  roleId: string;
  coverage: string;
  // Extra permissions granted on top of whatever roleId already grants — see
  // auth.service.ts's createStaffUser.
  permissionIds?: string[];
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
