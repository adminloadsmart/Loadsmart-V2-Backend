import {
  Between,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { DateRange } from '../../../shared/utils/date-filter';
import { MaintenanceJobEntity } from '../entities/maintenance-job.entity';
import { MaintenanceJobType, OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance.types';

export type CreateMaintenanceJobData = Omit<
  MaintenanceJobEntity,
  'id' | 'vehicle' | 'tyres' | 'createdAt' | 'updatedAt' | 'updatedBy'
>;
export type UpdateMaintenanceJobData = Partial<
  Omit<
    MaintenanceJobEntity,
    | 'id'
    | 'tenantId'
    | 'vehicleId'
    | 'vehicle'
    | 'tyres'
    | 'jobType'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
  >
>;

/** Own-fleet scoping on the joined vehicle — every read here goes through it, so an attached
 *  truck's job (there shouldn't be one; writes refuse them) could never reach the screen. */
const ownFleet = { ownershipType: In([...OWN_FLEET_OWNERSHIP_TYPES]) };

export class MaintenanceJobRepository {
  private readonly jobs: Repository<MaintenanceJobEntity>;

  constructor(dataSource: DataSource) {
    this.jobs = dataSource.getRepository(MaintenanceJobEntity);
  }

  private repo(manager?: EntityManager): Repository<MaintenanceJobEntity> {
    return manager?.getRepository(MaintenanceJobEntity) ?? this.jobs;
  }

  create(data: CreateMaintenanceJobData, manager?: EntityManager): Promise<MaintenanceJobEntity> {
    const repo = this.repo(manager);
    return repo.save(repo.create(data));
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<MaintenanceJobEntity | null> {
    return this.repo(manager).findOne({
      where: { id, tenantId },
      relations: { vehicle: { telemetryMeta: true, truckType: true }, tyres: true },
    });
  }

  /** The truck's current workshop visit, of either type — there is at most one. */
  findOpenJob(
    tenantId: string,
    vehicleId: string,
    manager?: EntityManager,
  ): Promise<MaintenanceJobEntity | null> {
    return this.repo(manager).findOneBy({ tenantId, vehicleId, status: 'open' });
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateMaintenanceJobData,
    manager?: EntityManager,
  ): Promise<MaintenanceJobEntity | null> {
    await this.repo(manager).update({ id, tenantId }, data);
    return this.findById(tenantId, id, manager);
  }

  /** Every own-fleet truck in the workshop right now, optionally only one job type. */
  listOpenJobs(tenantId: string, jobType?: MaintenanceJobType): Promise<MaintenanceJobEntity[]> {
    return this.jobs.find({
      where: {
        tenantId,
        ...(jobType ? { jobType } : {}),
        status: 'open',
        vehicle: { ...ownFleet, deletedAt: IsNull() },
      },
      relations: { vehicle: { telemetryMeta: true, truckType: true } },
      order: { openedAt: 'ASC' },
    });
  }

  /** Every job whose [opened, closed ?? now] overlaps the window — the downtime headline. */
  listOverlapping(tenantId: string, range: DateRange): Promise<MaintenanceJobEntity[]> {
    const base: FindOptionsWhere<MaintenanceJobEntity> = {
      tenantId,
      openedAt: LessThanOrEqual(range.to),
      vehicle: ownFleet,
    };
    return this.jobs.find({
      where: [
        { ...base, closedAt: IsNull() },
        { ...base, closedAt: MoreThanOrEqual(range.from) },
      ],
      relations: { vehicle: { telemetryMeta: true } },
    });
  }

  /** Spend headline — job count and total cost per job type, jobs opened in the window. */
  async spendByType(
    tenantId: string,
    range: DateRange,
  ): Promise<{ jobType: MaintenanceJobType; count: number; total: number }[]> {
    const rows = await this.jobs
      .createQueryBuilder('job')
      .innerJoin('job.vehicle', 'vehicle')
      .select('job.job_type', 'jobType')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect('COALESCE(SUM(job.total_cost), 0)', 'total')
      .where('job.tenant_id = :tenantId', { tenantId })
      .andWhere('job.opened_at BETWEEN :from AND :to', range)
      .andWhere('vehicle.ownership_type IN (:...own)', { own: [...OWN_FLEET_OWNERSHIP_TYPES] })
      // A service check-in released without being serviced isn't a service.
      .andWhere(
        "NOT (job.job_type = 'service' AND job.status = 'closed' AND job.service_type IS NULL)",
      )
      .groupBy('job.job_type')
      .getRawMany<{ jobType: MaintenanceJobType; count: number; total: string }>();

    return rows.map((row) => ({
      jobType: row.jobType,
      count: Number(row.count),
      total: Number(row.total),
    }));
  }

  /** Job history — jobs opened in the window, newest first. */
  list(
    tenantId: string,
    filters: {
      range: DateRange;
      vehicleId?: string;
      jobType?: MaintenanceJobType;
      page: number;
      limit: number;
    },
  ): Promise<[MaintenanceJobEntity[], number]> {
    const { range, vehicleId, jobType, page, limit } = filters;
    return this.jobs.findAndCount({
      where: {
        tenantId,
        openedAt: Between(range.from, range.to),
        vehicle: ownFleet,
        ...(vehicleId ? { vehicleId } : {}),
        ...(jobType ? { jobType } : {}),
      },
      relations: { vehicle: { truckType: true }, tyres: true },
      order: { openedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }
}
