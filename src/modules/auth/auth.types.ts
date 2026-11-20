import type { SalesType } from '../../shared/constants/roles';
/* Service-layer inputs — shapes accepted by AuthService's methods. */

export interface SignupInput {
  phoneNumber: string;
  /** Server-derived (req.ip), never client-supplied — for the OTP request limit (LS_N_0008). */
  ipAddress?: string | null;
}

export interface RequestLoginOtpInput {
  phoneNumber: string;
  portal: LoginPortal;
  /** Server-derived (req.ip), never client-supplied — for the OTP request limit (LS_N_0008). */
  ipAddress?: string | null;
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
  whatsappOptIn?: boolean;
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

// Sales-type team members only (team = sales) — notes §4: "tracker-sales vs shipper-sales, region,
// state, and ASM". asmUserId is the Area Sales Manager a salesperson reports into; required for
// a salesperson, not allowed for an ASM.
export interface StaffSalesInput {
  salesType: SalesType;
  state: string;
  asmUserId?: string | null;
}

// A team member (POST /admin/staff) — the "Team members" form (notes §4). roleId is the team (an
// auth.roles row from STAFF_TEAMS) and decides all access; teamRole is the job title within that
// team (TEAM_ROLES) and decides none. No password and no per-user permissions: login is OTP-only,
// and access comes from the team alone (strictly one team per person).
// employeeId is typed in by the admin: LS + 4 digits (EMPLOYEE_ID_REGEX), unique among active users.
export interface CreateStaffInput {
  fullName: string;
  employeeId: string;
  phoneNumber: string;
  email: string;
  roleId: string;
  teamRole: string;
  reportsToUserId?: string | null;
  region: string;
  sales?: StaffSalesInput;
}

// PATCH /admin/staff/:staffId — every field optional; validated against the merged result.
// reportsToUserId/sales accept null to clear them.
export interface UpdateStaffInput {
  fullName?: string;
  employeeId?: string;
  phoneNumber?: string;
  email?: string;
  roleId?: string;
  teamRole?: string;
  reportsToUserId?: string | null;
  region?: string;
  sales?: StaffSalesInput | null;
}

// Org admin inviting a teammate into their own org — the organization-scope counterpart to
// CreateStaffInput. Phone only, no email: see auth.service.ts's inviteOrganizationUser.
export interface InviteOrganizationUserInput {
  fullName: string;
  /** Work email (Settings → Users & Roles "Invite a User"). */
  email: string;
  /** Still required — every login path (/login, /login/otp/*) is phone-based. */
  phoneNumber: string;
  roleId: string;
  basedAtLoadingPointId?: string | null;
}

export interface ListOrganizationUsersInput {
  search?: string;
  role?: string;
  status?: 'active' | 'invited';
  page: number;
  limit: number;
}

/** Settings → Users & Roles "Change Seat": a new seat (role) and/or "Based at". */
export interface ChangeOrganizationUserSeatInput {
  roleId?: string;
  basedAtLoadingPointId?: string | null;
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

/** A platform staff member's id and role name — AuthRepository.listAllStaffRoles. */
export interface StaffMemberRole {
  id: string;
  role: string;
}

/** One role's card on the admin Employees screen (AuthService.getStaffSummary). */
export interface StaffRoleSummary {
  count: number;
  workload: number;
  signups: number;
  approvedSignups: number;
}
