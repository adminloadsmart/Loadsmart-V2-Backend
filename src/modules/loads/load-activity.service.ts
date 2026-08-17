import { EntityManager } from 'typeorm';
import { rethrow } from '../../shared/errors';
import { LoadActivityRepository } from './load-activity.repository';
import { LoadActivityEntity } from './entities/load-activity.entity';
import { LoadActivityAction } from './utils/loads.types';

/**
 * Thin wrapper around LoadActivityRepository — see load-activity.entity.ts's doc comment for why
 * this dedicated per-load table exists alongside the shared platform-wide `audit` module.
 */
export class LoadActivityService {
  constructor(private readonly repository: LoadActivityRepository) {}

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

  async listByLoad(tenantId: string, loadId: string): Promise<LoadActivityEntity[]> {
    try {
      return await this.repository.listByLoad(tenantId, loadId);
    } catch (error) {
      rethrow(error, 'Failed to list load activity');
    }
  }
}
