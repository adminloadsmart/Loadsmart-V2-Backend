import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { LoadIssueReportEntity } from './entities/load-issue-report.entity';
import { LoadIssueCategory } from './utils/loads.types';

export interface CreateLoadIssueReportData {
  tenantId: string;
  loadId: string;
  reportedBy: string | null;
  category: LoadIssueCategory;
  details?: string | null;
  latitude: number;
  longitude: number;
  locationLabel: string;
  locationCapturedAt: string;
  photoFileKeys?: string[] | null;
}

export class LoadIssueRepository {
  private readonly issues: Repository<LoadIssueReportEntity>;

  constructor(dataSource: DataSource) {
    this.issues = dataSource.getRepository(LoadIssueReportEntity);
  }

  create(data: CreateLoadIssueReportData, manager?: EntityManager): Promise<LoadIssueReportEntity> {
    const repo = manager?.getRepository(LoadIssueReportEntity) ?? this.issues;
    const issue = repo.create({
      ...data,
      latitude: String(data.latitude),
      longitude: String(data.longitude),
      locationCapturedAt: new Date(data.locationCapturedAt),
      details: data.details ?? null,
      photoFileKeys: data.photoFileKeys ?? null,
    });
    return repo.save(issue);
  }

  // The newest unresolved report on a load — drives the trip-detail incident card and the hold.
  findLatestOpenByLoad(tenantId: string, loadId: string): Promise<LoadIssueReportEntity | null> {
    return this.issues.findOne({
      where: { tenantId, loadId, resolvedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  // Only flips a still-open report, so a double resolve is a no-op that returns null.
  async resolve(
    tenantId: string,
    loadId: string,
    issueId: string,
    resolvedBy: string,
  ): Promise<LoadIssueReportEntity | null> {
    const result = await this.issues.update(
      { id: issueId, tenantId, loadId, resolvedAt: IsNull() },
      { resolvedAt: new Date(), resolvedBy },
    );
    if (!result.affected) return null;
    return this.issues.findOneBy({ id: issueId, tenantId, loadId });
  }

  // Most recent first — read as a feed, unlike load-payment.repository.ts's listByLoad (one
  // advance + one balance, chronological 'ASC' reads naturally instead).
  listByLoad(tenantId: string, loadId: string): Promise<LoadIssueReportEntity[]> {
    return this.issues.find({ where: { tenantId, loadId }, order: { createdAt: 'DESC' } });
  }
}
