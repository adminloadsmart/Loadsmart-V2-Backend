import {
  MASTER_KIND_LABELS,
  MasterApprovalRequestedContext,
  MasterApprovalsWaitingContext,
  MasterApprovedContext,
  MasterKind,
  MasterRejectedContext,
  VahanUnverifiedContext,
  masterApprovers,
} from './catalog/notification-catalog';
import {
  MasterApprovalNotifier,
  MasterApprovalResolverDeps,
  NotificationTriggers,
} from './notifications.interface';
import { ScheduledAlertRepository } from './scheduled-alert.repository';

/**
 * LS_N_0009 "master addition needs approval" / LS_N_0010 "master approved". The masters, driver
 * and customers services call this notifier right after their existing create/approve logic —
 * it only queues a trigger (names and counts are resolved later in the trigger worker, keeping
 * their request path light) and never throws, so it can't change what those services do.
 */

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
export function createVahanStillUnverifiedCheck(
  scheduledAlertRepository: ScheduledAlertRepository,
) {
  return async (tenantId: string, context: VahanUnverifiedContext): Promise<boolean> => {
    if (!(await scheduledAlertRepository.vehicleExists(tenantId, context.vehicleId))) return false;
    const latestStatus = await scheduledAlertRepository.findLatestVahanStatus(
      tenantId,
      context.vehicleId,
    );
    return latestStatus !== 'verified';
  };
}

/** Records still pending of the kinds a user with these permissions/role can approve — LS_N_0010's
 *  "N waiting" and LS_N_0060's morning-brief approvals count. */
export async function countPendingApprovals(
  scheduledAlertRepository: ScheduledAlertRepository,
  tenantId: string,
  permissions: string[],
  role: string | null,
): Promise<number> {
  const approvableKinds = (Object.keys(MASTER_KIND_LABELS) as MasterKind[]).filter((kind) => {
    const approvers = masterApprovers(kind);
    return (
      permissions.includes(approvers.permission) && (!approvers.role || approvers.role === role)
    );
  });
  const pendingCounts = await Promise.all(
    approvableKinds.map((kind) => scheduledAlertRepository.countPendingMasters(tenantId, kind)),
  );
  return pendingCounts.reduce((sum, pendingCount) => sum + pendingCount, 0);
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
      const waitingCount = await countPendingApprovals(
        deps.scheduledAlertRepository,
        tenantId,
        permissions,
        role,
      );
      return waitingCount > 0 ? { ...context, waitingCount } : null;
    },
  };
}
