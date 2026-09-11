import { Role } from '../constants/roles';
import { LoginPortal } from '../../modules/auth/auth.types';
import { DriverLoginCandidate } from '../../modules/driver/driver-auth.types';

export interface AuthenticatedUser {
  id: string;
  // Genuinely null at runtime in two cases, so the type says so instead of lying and forcing
  // every caller to silently trust a non-null assertion:
  // (1) /auth's own authenticatedRouters-tier routes (logout, deleteAccount, GET/PATCH
  //     /auth/organization) sit ahead of createTenantScope and can see this as null — a user who
  //     hasn't completed their company profile yet has no organization; see auth.controller.ts.
  // (2) every platform-scope role (PLATFORM_SCOPE_ROLES — platform_admin plus all
  //     STAFF_ASSIGNABLE_ROLES) is exempted from createTenantScope entirely (see
  //     tenant-scope.middleware.ts) since none of them are tenant-scoped by design — always null.
  // Everywhere else (every tenant-owned-resource router, e.g. masters — see
  // require-tenant.middleware.ts) it's guaranteed non-null before the route handler runs.
  tenantId: string | null;
  role: Role;
  // Effective permissions at the time the token was issued (role's permissions ∪ direct grants
  // — see role.service.ts's getEffectivePermissions).
  permissions: string[];
  // Snapshot of the user's permissions_version at token-issuance time. auth.middleware.ts
  // compares this against the live DB value (Redis-cached ~30s, see
  // permissions-version-cache.ts) on every request, so a role/permission change bumped by
  // role.service.ts's assignRole/grantPermission/revokePermission takes effect promptly instead
  // of waiting for this token to expire or for the client to hit /auth/refresh.
  permissionsVersion: number;
  portal: LoginPortal;
  jti?: string;
  // The id of the auth.refresh_tokens row created alongside this access token (see
  // auth.service.ts's issueTokenPair) — rotates on every /auth/refresh just like that row does,
  // so it always identifies the CURRENT session, never a stale one. Used by POST
  // /auth/device-token and /auth/logout so neither needs a refreshToken in the request body.
  sid?: string;
  exp?: number;
}

export interface SignupPayload {
  phoneNumber: string;
}

export interface LoginPayload {
  phoneNumber: string;
  portal: LoginPortal;
}

// A driver-app principal — deliberately NOT AuthenticatedUser. No role, no permissions, no
// permissionsVersion: a driver's authorization is "only ever myself", not RBAC, so there is
// nothing here for requirePermission(...) to read even if a driver token somehow reached it. See
// docs/driver-auth.md and driver-auth.middleware.ts's createDriverAuth.
export interface AuthenticatedDriver {
  id: string; // masters.drivers.id
  tenantId: string; // never null — DriverEntity.tenantId is NOT NULL, unlike AuthenticatedUser's
  jti?: string;
  // The id of the masters.driver_sessions row created alongside this access token — same
  // rotates-on-refresh, identifies-the-current-session convention as AuthenticatedUser.sid.
  sid?: string;
  exp?: number;
}

export interface DriverLoginPayload {
  phoneNumber: string;
  candidates: DriverLoginCandidate[];
}

export interface DriverTenantSelectPayload {
  candidates: DriverLoginCandidate[];
}

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthenticatedUser;
      signupPayload?: SignupPayload;
      loginPayload?: LoginPayload;
      driver?: AuthenticatedDriver;
      driverLoginPayload?: DriverLoginPayload;
      driverTenantSelectPayload?: DriverTenantSelectPayload;
      // The validate() middleware's coerced/defaulted query result — NOT req.query. Express 5
      // made req.query a read-only getter that re-parses the raw URL on every access, so mutating
      // it in place (the old Express 4 approach) silently no-ops; see validate.middleware.ts.
      validatedQuery?: unknown;
    }
  }
}
