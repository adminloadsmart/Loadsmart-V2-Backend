import type { AuditService } from '../audit/audit.service';

/** Shapes the roles module shares with other modules. */

/** What changed, for the "your access changed" notification (LS_N_0006) — `before` is the target's
 *  effective permission keys just before the change; the listener reads "after" itself. */
export interface CapabilitiesChange {
  tenantId: string;
  userId: string;
  actorUserId: string;
  before: string[];
}

/** What the roles module needs from the rest of the app (createRolesModule). */
export interface RolesModuleDeps {
  auditService: AuditService;
  // A plain function rather than a typed AuthRepository/AuthService dependency — see
  // role.service.ts and composition-root.ts for why (auth already depends on roles.service,
  // so the reverse can't be a typed cross-module import without cycling).
  revokeRefreshTokensForUser: (userId: string) => Promise<void>;
  // LS_N_0006 "your access changed" — optional; see RoleService's constructor.
  onCapabilitiesChanged?: (change: CapabilitiesChange) => Promise<void>;
}
