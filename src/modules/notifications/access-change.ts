import { redisManager } from '../../db/redis';
import { joinCapabilities } from './capability-wording';
import { NotificationTriggers } from './notification-triggers';
import { AccessChangedContext } from './catalog/notification-catalog';

/**
 * LS_N_0006 "your access changed". An admin changes capabilities one API call at a time, so the
 * notification is debounced (see the catalog entry's debounceMs): every change re-queues it, and
 * only one runs once the burst is over. The diff it reports is "before the FIRST change of the
 * burst" vs "now" — that first "before" is kept in Redis (first write wins) and carried in every
 * re-queued payload, so a retried job always diffs against the same baseline.
 */
const BASELINE_TTL_SECONDS = 60 * 60; // comfortably longer than any debounce window
const baselineKey = (userId: string) => `notifications:access-baseline:${userId}`;

export interface CapabilitiesChangeEvent {
  tenantId: string;
  userId: string;
  actorUserId: string;
  before: string[];
}

/** Called (via RoleService's onCapabilitiesChanged hook) after each capability change. */
export function createAccessChangeRecorder(triggers: NotificationTriggers) {
  return async ({ tenantId, userId, actorUserId, before }: CapabilitiesChangeEvent) => {
    let baseline = await redisManager.get(baselineKey(userId));
    if (!baseline) {
      baseline = JSON.stringify(before);
      await redisManager.set(baselineKey(userId), baseline, BASELINE_TTL_SECONDS);
    }
    await triggers.enqueue('user.access_changed', tenantId, {
      userId,
      adminUserId: actorUserId,
      baselinePermissions: JSON.parse(baseline) as string[],
    });
  };
}

export interface AccessChangeResolverDeps {
  getEffectivePermissions(userId: string): Promise<string[]>;
  describePermissions(keys: string[]): Promise<string[]>;
  getUserFullName(userId: string): Promise<string | null>;
  getOrganizationName(tenantId: string): Promise<string>;
}

/** The trigger worker's context resolver for LS_N_0006: computes what was actually added and
 *  removed across the whole burst. Returns null — nothing is sent — when the net effect is nil
 *  (e.g. a capability added then removed, or granted when the role already had it): the sheet's
 *  "suppress when the change is cosmetic or has no effect". */
export function createAccessChangeResolver(deps: AccessChangeResolverDeps) {
  return async (
    tenantId: string,
    context: AccessChangedContext,
  ): Promise<AccessChangedContext | null> => {
    // This burst is being sent now; a change from here on starts a new baseline.
    await redisManager.delete(baselineKey(context.userId));

    let after: string[];
    try {
      after = await deps.getEffectivePermissions(context.userId);
    } catch {
      return null; // user gone — nothing to tell them
    }
    const before = new Set(context.baselinePermissions);
    const now = new Set(after);
    // Sorted so the same change always reads the same way.
    const added = after.filter((key) => !before.has(key)).sort();
    const removed = context.baselinePermissions.filter((key) => !now.has(key)).sort();
    if (!added.length && !removed.length) return null;

    const [addedDescriptions, removedDescriptions, adminName, orgName] = await Promise.all([
      deps.describePermissions(added),
      deps.describePermissions(removed),
      deps.getUserFullName(context.adminUserId),
      deps.getOrganizationName(tenantId),
    ]);
    return {
      ...context,
      adminName: adminName || 'Your admin',
      orgName,
      addedCapabilities: joinCapabilities(addedDescriptions),
      removedCapabilities: joinCapabilities(removedDescriptions),
      removedCount: removed.length,
    };
  };
}
