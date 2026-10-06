import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { FleetAnalyticsFilters } from './utils/fleet-analytics.interface';
import { HELD_AS_OWNERSHIP } from './utils/fleet-analytics.constants';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { TruckTypeEntity } from '../../masters/truck-type/entities/truck-type.entity';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { MaintenanceJobEntity } from '../../maintenance/entities/maintenance-job.entity';
import { TyreEntity } from '../../maintenance/entities/tyre.entity';
import { TyreReadingEntity } from '../../maintenance/entities/tyre-reading.entity';
import { DriverTenantRelationEntity } from '../../driver/entities/driver-tenant-relation.entity';
import { MAINTAINED_VEHICLE_STATUSES } from '../../maintenance/maintenance.types';

// Reads masters/maintenance/driver entities directly via the DataSource, same as
// AnalyticsRepository (shipper analytics) — a reporting concern spanning several modules, not a
// business-logic dependency, so it doesn't go through those modules' own repositories/services.
// Plain Repository.find() + in-JS aggregation throughout (no createQueryBuilder/raw SQL
// expressions) — see prefer-typeorm-no-raw-sql: TypeORM's Repository API has no SUM/GROUP BY,
// so aggregation happens in application code instead of in the query.
export class FleetAnalyticsRepository {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly truckTypes: Repository<TruckTypeEntity>;
  private readonly customers: Repository<CustomerEntity>;
  private readonly jobs: Repository<MaintenanceJobEntity>;
  private readonly tyres: Repository<TyreEntity>;
  private readonly tyreReadings: Repository<TyreReadingEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.truckTypes = dataSource.getRepository(TruckTypeEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.jobs = dataSource.getRepository(MaintenanceJobEntity);
    this.tyres = dataSource.getRepository(TyreEntity);
    this.tyreReadings = dataSource.getRepository(TyreReadingEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
  }

  /** The running fleet the filter bar selects — onboarded, not retired, narrowed by "Held as"
   *  and "Truck class". Carries everything the tabs read off a vehicle: class, fixed costs,
   *  odometer, papers and the VAHAN registration date (for age). */
  listScopedVehicles(tenantId: string, filters: FleetAnalyticsFilters): Promise<VehicleEntity[]> {
    return this.vehicles.find({
      where: {
        tenantId,
        deletedAt: IsNull(),
        status: In([...MAINTAINED_VEHICLE_STATUSES]),
        ownershipType: In(HELD_AS_OWNERSHIP[filters.heldAs]),
        ...(filters.truckTypeId ? { truckTypeId: filters.truckTypeId } : {}),
      },
      relations: {
        truckType: true,
        telemetryMeta: true,
        serviceUsage: true,
        documents: true,
        verificationSnapshots: true,
      },
      order: { registrationNumber: 'ASC' },
    });
  }

  /** Every job on these vehicles whose [openedAt, closedAt ?? now] overlaps the window — both
   *  downtime (overlap) and spend (opened inside the window) are derived from this one read. */
  listJobsOverlapping(
    tenantId: string,
    vehicleIds: string[],
    range: { from: Date; to: Date },
  ): Promise<MaintenanceJobEntity[]> {
    if (vehicleIds.length === 0) return Promise.resolve([]);
    const base: FindOptionsWhere<MaintenanceJobEntity> = {
      tenantId,
      vehicleId: In(vehicleIds),
      openedAt: LessThanOrEqual(range.to),
    };
    return this.jobs.find({
      where: [
        { ...base, closedAt: IsNull() },
        { ...base, closedAt: MoreThanOrEqual(range.from) },
      ],
      order: { openedAt: 'ASC' },
    });
  }

  /** Trucks in the workshop right now — current state, independent of the period. */
  listOpenJobs(tenantId: string, vehicleIds: string[]): Promise<MaintenanceJobEntity[]> {
    if (vehicleIds.length === 0) return Promise.resolve([]);
    return this.jobs.find({
      where: { tenantId, vehicleId: In(vehicleIds), status: 'open' },
    });
  }

  /** Tyres fitted to these vehicles now, with each one's latest gauge reading (or null). */
  async listFittedTyres(
    tenantId: string,
    vehicleIds: string[],
  ): Promise<{ tyre: TyreEntity; reading: TyreReadingEntity | null }[]> {
    if (vehicleIds.length === 0) return [];
    const tyres = await this.tyres.find({
      where: { tenantId, vehicleId: In(vehicleIds), status: 'fitted' },
    });
    if (tyres.length === 0) return [];

    const readings = await this.tyreReadings.find({
      where: { tenantId, tyreId: In(tyres.map((tyre) => tyre.id)) },
      order: { readingDate: 'DESC', createdAt: 'DESC' },
    });
    const latest = new Map<string, TyreReadingEntity>();
    for (const reading of readings) {
      if (!latest.has(reading.tyreId)) latest.set(reading.tyreId, reading);
    }

    return tyres.map((tyre) => ({ tyre, reading: latest.get(tyre.id) ?? null }));
  }

  /** Drivers on the tenant's roll, with their DL verifications (for licence class). */
  listActiveDrivers(tenantId: string): Promise<DriverTenantRelationEntity[]> {
    return this.driverRelations.find({
      where: { tenantId, status: 'active', deletedAt: IsNull(), driver: { deletedAt: IsNull() } },
      relations: { driver: { verifications: true } },
    });
  }

  listTruckTypes(tenantId: string): Promise<TruckTypeEntity[]> {
    return this.truckTypes.find({
      where: { tenantId, deletedAt: IsNull() },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
  }

  listCustomers(tenantId: string): Promise<CustomerEntity[]> {
    return this.customers.find({
      where: { tenantId, deletedAt: IsNull() },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
  }
}
