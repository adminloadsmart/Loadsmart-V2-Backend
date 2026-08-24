import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrganizationJourneyStageHistoryEntity } from './entities/organization-journey-stage-history.entity';
import { OrganizationJourneyStage } from './entities/organization.entity';

export class OrganizationJourneyStageHistoryRepository {
  private readonly repo: Repository<OrganizationJourneyStageHistoryEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(OrganizationJourneyStageHistoryEntity);
  }

  async create(
    organizationId: string,
    stage: OrganizationJourneyStage,
    changedBy: string | null,
    manager?: EntityManager,
  ): Promise<OrganizationJourneyStageHistoryEntity> {
    const repo = manager ? manager.getRepository(OrganizationJourneyStageHistoryEntity) : this.repo;
    const entry = repo.create({ organizationId, stage, changedBy });
    return repo.save(entry);
  }

  // Unpaginated, like OrganizationDocumentRepository.findActiveByOrganization — embedded whole
  // into AdminService.getOrganization's response, not its own paginated endpoint. Chronological
  // (oldest first): this is a trail meant to be read top-to-bottom as the org's progress, unlike
  // AuditRepository.findByOrganization's most-recent-first ordering.
  async findByOrganization(
    organizationId: string,
  ): Promise<OrganizationJourneyStageHistoryEntity[]> {
    return this.repo.find({
      where: { organizationId },
      relations: { changedByUser: true },
      select: {
        changedByUser: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      order: { createdAt: 'ASC' },
    });
  }

  // Batched counterpart to findByOrganization above, for AdminService.listOrganizations — one
  // query for the whole page instead of one per row. Same relations/select/ordering contract,
  // just grouped by organizationId afterward; each group stays oldest-first like the single-org
  // method promises.
  async findByOrganizationIds(
    organizationIds: string[],
  ): Promise<Map<string, OrganizationJourneyStageHistoryEntity[]>> {
    if (organizationIds.length === 0) return new Map();

    const entries = await this.repo.find({
      where: { organizationId: In(organizationIds) },
      relations: { changedByUser: true },
      select: {
        changedByUser: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      order: { organizationId: 'ASC', createdAt: 'ASC' },
    });

    const byOrganization = new Map<string, OrganizationJourneyStageHistoryEntity[]>();
    for (const entry of entries) {
      const group = byOrganization.get(entry.organizationId);
      if (group) {
        group.push(entry);
      } else {
        byOrganization.set(entry.organizationId, [entry]);
      }
    }
    return byOrganization;
  }
}
