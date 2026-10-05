import { DataSource } from 'typeorm';
import { NotificationTriggers } from './notification-triggers';
import {
  MasterApprovalRequestedContext,
  MasterApprovalsWaitingContext,
  MasterApprovedContext,
  MasterKind,
  MasterRejectedContext,
  masterApprovers,
} from './catalog/notification-catalog';

/**
 * LS_N_0009 "master addition needs approval" / LS_N_0010 "master approved". The masters, driver
 * and customers services call this notifier right after their existing create/approve logic —
 * it only queues a trigger (names and counts are resolved later in the trigger worker, keeping
 * their request path light) and never throws, so it can't change what those services do.
 */
export interface MasterApprovalEvent {
  kind: MasterKind;
  tenantId: string;
  recordId: string;
  masterValue: string;
  createdBy: string | null;
}

export interface MasterApprovalNotifier {
  /** Call after a record is created — no-op unless it's actually waiting for approval. */
  requested(event: MasterApprovalEvent & { pending: boolean }): Promise<void>;
  /** Call after a pending record is approved. */
  approved(event: MasterApprovalEvent & { approvedBy: string }): Promise<void>;
  /** Call after a pending record is rejected (LS_N_0011). */
  rejected(event: MasterApprovalEvent & { rejectedBy: string; reason: string }): Promise<void>;
  /** Call after a Vahan verification result is recorded for a vehicle (LS_N_0012) — no-op
   *  unless it's a failure (not_found / manual_review). */
  vahanResult(event: {
    tenantId: string;
    vehicleId: string;
    vehicleNo: string;
    createdBy: string | null;
    verificationStatus: string;
  }): Promise<void>;
}

/** Recorded Vahan results that count as "returned nothing or failed" (LS_N_0012). */
const VAHAN_FAILED_STATUSES = ['not_found', 'manual_review'];

export function createMasterApprovalNotifier(
  triggers: NotificationTriggers,
): MasterApprovalNotifier {
  return {
    async requested({ kind, tenantId, recordId, masterValue, createdBy, pending }) {
      if (!pending || !createdBy) return;
      try {
        await triggers.enqueue('organization.master_approval_requested', tenantId, {
          kind,
          recordId,
          masterValue,
          createdByUserId: createdBy,
        });
      } catch (error) {
        console.warn(
          `Failed to queue approval-request notification for ${kind} ${recordId}`,
          error,
        );
      }
    },
    async approved({ kind, tenantId, recordId, masterValue, createdBy, approvedBy }) {
      // Nobody to tell when there's no recorded creator, or the creator approved it themselves.
      if (!createdBy || createdBy === approvedBy) return;
      try {
        await triggers.enqueue('organization.master_approved', tenantId, {
          kind,
          recordId,
          masterValue,
          createdByUserId: createdBy,
          approvedByUserId: approvedBy,
        });
      } catch (error) {
        console.warn(`Failed to queue approved notification for ${kind} ${recordId}`, error);
      }
    },
    async rejected({ kind, tenantId, recordId, masterValue, createdBy, rejectedBy, reason }) {
      if (!createdBy || createdBy === rejectedBy) return;
      try {
        await triggers.enqueue('organization.master_rejected', tenantId, {
          kind,
          recordId,
          masterValue,
          createdByUserId: createdBy,
          rejectedByUserId: rejectedBy,
          reason,
        });
      } catch (error) {
        console.warn(`Failed to queue rejected notification for ${kind} ${recordId}`, error);
      }
    },
    async vahanResult({ tenantId, vehicleId, vehicleNo, createdBy, verificationStatus }) {
      if (!VAHAN_FAILED_STATUSES.includes(verificationStatus)) return;
      try {
        await triggers.enqueue('vehicle.vahan_unverified', tenantId, {
          vehicleId,
          vehicleNo,
          createdByUserId: createdBy,
        });
      } catch (error) {
        console.warn(
          `Failed to queue Vahan-unverified notification for vehicle ${vehicleId}`,
          error,
        );
      }
    },
  };
}

/** LS_N_0012's relevance check, run when the 24h wait is over: only if the vehicle still exists
 *  and its latest recorded Vahan result is not 'verified' (a successful retry in the meantime
 *  cancels the alert). */
export function createVahanStillUnverifiedCheck(dataSource: DataSource) {
  return async (tenantId: string, context: { vehicleId: string }): Promise<boolean> => {
    const [vehicle] = await dataSource.query(
      `SELECT 1 FROM masters.vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [context.vehicleId, tenantId],
    );
    if (!vehicle) return false;
    const [latest] = await dataSource.query(
      `SELECT verification_status FROM masters.vehicle_verification_snapshots
        WHERE vehicle_id = $1 AND tenant_id = $2 ORDER BY checked_at DESC, created_at DESC LIMIT 1`,
      [context.vehicleId, tenantId],
    );
    return latest?.verification_status !== 'verified';
  };
}

/** Pending records per kind, matching each service's own "pending" (products use
 *  approval_status; the rest use status). Raw counts so no other module's code is touched. */
const PENDING_COUNT_SQL: Record<MasterKind, string> = {
  vehicle: `SELECT count(*)::int AS n FROM masters.vehicles WHERE tenant_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
  driver: `SELECT count(*)::int AS n FROM masters.drivers WHERE tenant_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
  loading_point: `SELECT count(*)::int AS n FROM masters.loading_points WHERE tenant_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
  product: `SELECT count(*)::int AS n FROM masters.products WHERE tenant_id = $1 AND approval_status = 'pending_approval' AND deleted_at IS NULL`,
  customer: `SELECT count(*)::int AS n FROM customers.customers WHERE tenant_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
};

export interface MasterApprovalResolverDeps {
  dataSource: DataSource;
  getUserFullName(userId: string): Promise<string | null>;
  getUserRoleName(userId: string): Promise<string | null>;
  getEffectivePermissions(userId: string): Promise<string[]>;
}

/** Context resolvers for the trigger worker (wired in composition-root.ts). */
export function createMasterApprovalResolvers(deps: MasterApprovalResolverDeps) {
  return {
    requested: async (
      _tenantId: string,
      context: MasterApprovalRequestedContext,
    ): Promise<MasterApprovalRequestedContext> => ({
      ...context,
      userName: (await deps.getUserFullName(context.createdByUserId)) ?? undefined,
    }),

    approved: async (
      _tenantId: string,
      context: MasterApprovedContext,
    ): Promise<MasterApprovedContext> => ({
      ...context,
      adminName: (await deps.getUserFullName(context.approvedByUserId)) ?? undefined,
    }),

    rejected: async (
      _tenantId: string,
      context: MasterRejectedContext,
    ): Promise<MasterRejectedContext> => ({
      ...context,
      adminName: (await deps.getUserFullName(context.rejectedByUserId)) ?? undefined,
    }),

    /** "N waiting" for this approver = records still pending of the kinds THEY can approve.
     *  Nothing is sent once that's zero (everything got approved/rejected meanwhile). */
    waiting: async (
      tenantId: string,
      context: MasterApprovalsWaitingContext,
    ): Promise<MasterApprovalsWaitingContext | null> => {
      const [permissions, role] = await Promise.all([
        deps.getEffectivePermissions(context.userId).catch(() => [] as string[]),
        deps.getUserRoleName(context.userId),
      ]);
      const kinds = (Object.keys(PENDING_COUNT_SQL) as MasterKind[]).filter((kind) => {
        const approvers = masterApprovers(kind);
        return (
          permissions.includes(approvers.permission) && (!approvers.role || approvers.role === role)
        );
      });
      const counts = await Promise.all(
        kinds.map(async (kind) => {
          const [row] = await deps.dataSource.query(PENDING_COUNT_SQL[kind], [tenantId]);
          return (row?.n as number) ?? 0;
        }),
      );
      const waitingCount = counts.reduce((sum, n) => sum + n, 0);
      return waitingCount > 0 ? { ...context, waitingCount } : null;
    },
  };
}
