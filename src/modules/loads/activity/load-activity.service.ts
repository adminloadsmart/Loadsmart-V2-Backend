import { EntityManager } from 'typeorm';
import { rethrow } from '../../../shared/errors';
import { AuthService } from '../../auth/auth.service';
import { LoadActivityRepository } from './load-activity.repository';
import { LoadActivityEntity } from '../entities/load-activity.entity';
import { LoadEntity } from '../entities/load.entity';
import { LoadActivityAction } from '../utils/loads.types';
import { LoadActivityWithActor, LoadAssignedBy } from '../utils/load-activity.interface';

/**
 * Thin wrapper around LoadActivityRepository — see load-activity.entity.ts's doc comment for why
 * this dedicated per-load table exists alongside the shared platform-wide `audit` module.
 */
export class LoadActivityService {
  constructor(
    private readonly repository: LoadActivityRepository,
    private readonly authService: AuthService,
  ) {}

  async record(
    tenantId: string,
    loadId: string,
    actorId: string | null,
    action: LoadActivityAction,
    fromValue: string | null = null,
    toValue: string | null = null,
    metadata: Record<string, unknown> | null = null,
    manager?: EntityManager,
  ): Promise<LoadActivityEntity> {
    try {
      return await this.repository.create(
        { tenantId, loadId, actorId, action, fromValue, toValue, metadata },
        manager,
      );
    } catch (error) {
      rethrow(error, 'Failed to record load activity');
    }
  }

  /** Resolves each row's actorId to a display name/role via one batched lookup — fixed at 2
   *  queries total (activities + one `IN` lookup for every distinct actor) regardless of how
   *  long the timeline is. Backs both this module's GET /loads/:loadId/activities and the
   *  timeline embedded in LoadService.get(), which both call this same method. */
  async listByLoad(tenantId: string, loadId: string): Promise<LoadActivityWithActor[]> {
    try {
      const activities = await this.repository.listByLoad(tenantId, loadId);
      const actorIds = [...new Set(activities.flatMap((a) => (a.actorId ? [a.actorId] : [])))];
      const actors = actorIds.length > 0 ? await this.authService.getUsersByIds(actorIds) : [];
      const actorById = new Map(actors.map((user) => [user.id, user]));

      return activities.map((activity) => {
        const actor = activity.actorId ? actorById.get(activity.actorId) : undefined;
        return {
          ...activity,
          actorName: actor?.fullName ?? null,
          actorRole: actor?.role?.name ?? null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to list load activity');
    }
  }

  /**
   * Who assigned each load's truck: the user behind its latest move into Truck assigned (market
   * and indent loads, and a bid accepted into one). Own-fleet loads are born in Truck assigned at
   * Dispatch Planning / posting with no such move, so their creator is the assigner. Null while
   * no truck is on the load, or when the move was made by the system. Two queries however many
   * loads are passed.
   */
  async assignedByLoad(loads: LoadEntity[]): Promise<Map<string, LoadAssignedBy | null>> {
    try {
      const activities = await this.repository.listTruckAssignments(loads.map((load) => load.id));
      const latest = new Map(activities.map((activity) => [activity.loadId, activity]));
      const assignment = new Map<string, { userId: string | null; at: Date | null }>();
      for (const load of loads) {
        const activity = latest.get(load.id);
        if (activity) assignment.set(load.id, { userId: activity.actorId, at: activity.createdAt });
        else if (load.sourceType === 'own_fleet') {
          assignment.set(load.id, { userId: load.createdBy, at: load.truckAssignedAt });
        }
      }

      const userIds = [
        ...new Set([...assignment.values()].flatMap((a) => (a.userId ? [a.userId] : []))),
      ];
      const users = userIds.length > 0 ? await this.authService.getUsersByIds(userIds) : [];
      const userById = new Map(users.map((user) => [user.id, user]));

      return new Map(
        loads.map((load) => {
          const entry = assignment.get(load.id);
          const user = entry?.userId ? userById.get(entry.userId) : undefined;
          return [
            load.id,
            entry && user
              ? {
                  userId: user.id,
                  name: user.fullName,
                  role: user.role?.name ?? null,
                  phoneNumber: user.phoneNumber ?? null,
                  assignedAt: entry.at?.toISOString() ?? null,
                }
              : null,
          ];
        }),
      );
    } catch (error) {
      rethrow(error, 'Failed to resolve who assigned the loads');
    }
  }
}
