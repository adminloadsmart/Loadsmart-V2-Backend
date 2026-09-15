import { DataSource, EntityManager, Repository } from 'typeorm';
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

  // Most recent first — read as a feed, unlike load-payment.repository.ts's listByLoad (one
  // advance + one balance, chronological 'ASC' reads naturally instead).
  listByLoad(tenantId: string, loadId: string): Promise<LoadIssueReportEntity[]> {
    return this.issues.find({ where: { tenantId, loadId }, order: { createdAt: 'DESC' } });
  }
}
