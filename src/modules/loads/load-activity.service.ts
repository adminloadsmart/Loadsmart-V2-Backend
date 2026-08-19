import { EntityManager } from 'typeorm';
import { rethrow } from '../../shared/errors';
import { AuthService } from '../auth/auth.service';
import { LoadActivityRepository } from './load-activity.repository';
import { LoadActivityEntity } from './entities/load-activity.entity';
import { LoadActivityAction } from './utils/loads.types';
import { LoadActivityWithActor } from './utils/load-activity.interface';

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
}
