import { EntityManager } from 'typeorm';
import { OrganizationService } from './organization.service';
import { OrganizationJourneyStageHistoryRepository } from './organization-journey-stage-history.repository';
import { OrganizationEntity, OrganizationJourneyStage } from './entities/organization.entity';
import { nextJourneyStage } from './organization.constants';

/** Owns OrganizationEntity.journeyStage (current value) plus the append-only trail of every stage
 *  transition it passed through. Called as a side effect of submit/assign/approve/reject — see
 *  AuthService.submitOrganization and AdminService's assignReviewer/approveOrganization/
 *  decideOrganization — never exposed as its own "set the stage" endpoint. */
export class OrganizationJourneyStageService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly historyRepository: OrganizationJourneyStageHistoryRepository,
  ) {}

  async recordTransition(
    organizationId: string,
    target: OrganizationJourneyStage,
    changedBy: string | null,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const current = await this.organizationService.getOrganizationStatus(organizationId, manager);
    const stage = nextJourneyStage(current.journeyStage, target);

    if (stage === current.journeyStage) {
      return current; // guarded no-op (e.g. a regression attempt) — no duplicate trail row
    }

    // Sequential, not Promise.all: both run against the same transaction's connection when a
    // manager is passed in, and TypeORM's QueryRunner doesn't support concurrent queries on one.
    const organization = await this.organizationService.updateOrganization(
      organizationId,
      { journeyStage: stage },
      manager,
    );
    await this.historyRepository.create(organizationId, stage, changedBy, manager);

    return organization;
  }

  // Unpaginated — see OrganizationJourneyStageHistoryRepository.findByOrganization. Embedded
  // whole into AdminService.getOrganization's response as `journeyStageHistory`.
  getTrail(organizationId: string) {
    return this.historyRepository.findByOrganization(organizationId);
  }

  // Batched counterpart to getTrail above, for AdminService.listOrganizations — every item on a
  // page gets its own `journeyStageHistory`, fetched as one query for the whole page rather than
  // one per row.
  getTrails(organizationIds: string[]) {
    return this.historyRepository.findByOrganizationIds(organizationIds);
  }
}
