import { Role } from '../constants/roles';

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
  // — see role.service.ts's getEffectivePermissions). Same staleness trade-off `role` already
  // had: changes take effect on next login/refresh, not instantly.
  permissions: string[];
  jti?: string;
  exp?: number;
}

export interface SignupPayload {
  phoneNumber: string;
}

export interface LoginPayload {
  phoneNumber: string;
}

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthenticatedUser;
      signupPayload?: SignupPayload;
      loginPayload?: LoginPayload;
      // The validate() middleware's coerced/defaulted query result — NOT req.query. Express 5
      // made req.query a read-only getter that re-parses the raw URL on every access, so mutating
      // it in place (the old Express 4 approach) silently no-ops; see validate.middleware.ts.
      validatedQuery?: unknown;
    }
  }
}
