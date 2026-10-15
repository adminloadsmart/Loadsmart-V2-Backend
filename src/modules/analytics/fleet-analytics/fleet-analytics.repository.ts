import {
  DataSource,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
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
import { BatterySohReadingEntity } from '../../maintenance/entities/battery-soh-reading.entity';
import { DriverTenantRelationEntity } from '../../driver/entities/driver-tenant-relation.entity';
import { MAINTAINED_VEHICLE_STATUSES } from '../../maintenance/maintenance.types';
import { LoadEntity } from '../../loads/entities/load.entity';
import { RequisitionEntity } from '../../loads/entities/requisition.entity';

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
  private readonly batteryReadings: Repository<BatterySohReadingEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;
  private readonly loads: Repository<LoadEntity>;
  private readonly requisitions: Repository<RequisitionEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.truckTypes = dataSource.getRepository(TruckTypeEntity);
    this.customers = dataSource.getRepository(CustomerEntity);
    this.jobs = dataSource.getRepository(MaintenanceJobEntity);
    this.tyres = dataSource.getRepository(TyreEntity);
    this.tyreReadings = dataSource.getRepository(TyreReadingEntity);
    this.batteryReadings = dataSource.getRepository(BatterySohReadingEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
    this.loads = dataSource.getRepository(LoadEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
  }

  /** The running fleet the filter bar selects — onboarded, not retired, narrowed by "Held as"
   *  and "Truck class". Carries everything the tabs read off a vehicle: class, fixed costs,
   *  odometer, papers and the VAHAN registration date (for age). */
  listScopedVehicles(tenantId: string, filters: FleetAnalyticsFilters): Promise<VehicleEntity[]> {
    return this.vehicles.find({
      where: scopedVehicleWhere(tenantId, filters),
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

  /** How many vehicles a filter combination selects — used to say which filter emptied a slice. */
  countScopedVehicles(
    tenantId: string,
    filters: Pick<FleetAnalyticsFilters, 'heldAs' | 'truckTypeId' | 'vehicleId'>,
  ): Promise<number> {
    return this.vehicles.count({ where: scopedVehicleWhere(tenantId, filters) });
  }

  /**
   * Loads these trucks were on during the window: assigned past `created`, started before the
   * window ends and not delivered before it starts. Narrowed by customer and lane. The exact
   * overlap is settled in code from the stage timestamps (loadInterval).
   */
  listLoadsInWindow(
    tenantId: string,
    vehicleIds: string[],
    range: { from: Date; to: Date },
    filters: Pick<FleetAnalyticsFilters, 'customerId' | 'laneKey'>,
  ): Promise<LoadEntity[]> {
    if (vehicleIds.length === 0) return Promise.resolve([]);
    const [loadingPointId, customerDeliveryPointId] = filters.laneKey?.split(':') ?? [];
    const requisition: FindOptionsWhere<RequisitionEntity> = {
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.laneKey ? { loadingPointId, customerDeliveryPointId } : {}),
    };
    const base: FindOptionsWhere<LoadEntity> = {
      tenantId,
      vehicleId: In(vehicleIds),
      status: Not('created'),
      createdAt: LessThanOrEqual(range.to),
      ...(Object.keys(requisition).length ? { requisition } : {}),
    };
    return this.loads.find({
      where: [
        { ...base, deliveredAt: IsNull() },
        { ...base, deliveredAt: MoreThanOrEqual(range.from) },
      ],
      relations: {
        requisition: { loadingPoint: true, customerDeliveryPoint: true },
      },
      order: { createdAt: 'ASC' },
    });
  }

  /** Every lane the tenant has raised a requisition on, for the lane filter. */
  listRequisitionLanes(tenantId: string): Promise<RequisitionEntity[]> {
    return this.requisitions.find({
      where: { tenantId },
      relations: { loadingPoint: true, customerDeliveryPoint: true },
      select: {
        id: true,
        loadingPointId: true,
        customerDeliveryPointId: true,
        loadingPoint: { id: true, city: true },
        customerDeliveryPoint: { id: true, city: true, location: true },
      },
    });
  }

  listVehicleOptions(tenantId: string): Promise<VehicleEntity[]> {
    return this.vehicles.find({
      where: {
        tenantId,
        deletedAt: IsNull(),
        status: In([...MAINTAINED_VEHICLE_STATUSES]),
      },
      select: { id: true, registrationNumber: true },
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

  /** Every dated odometer reading we hold for these vehicles up to `until` — job check-ins,
   *  tyre gauge readings, battery SoH readings, tyre fit/removal. Loads carry no distance, so
   *  km run in a window is read off these. Date columns come back as 'YYYY-MM-DD' strings. */
  async listOdometerReadings(
    tenantId: string,
    vehicleIds: string[],
    until: Date,
  ): Promise<{ vehicleId: string; at: Date | string; km: number }[]> {
    if (vehicleIds.length === 0) return [];
    const [jobs, tyres, tyreReadings, batteryReadings] = await Promise.all([
      this.jobs.find({
        where: {
          tenantId,
          vehicleId: In(vehicleIds),
          openedAt: LessThanOrEqual(until),
          odometerKm: Not(IsNull()),
        },
        select: { vehicleId: true, openedAt: true, odometerKm: true },
      }),
      this.tyres.find({
        where: { tenantId, vehicleId: In(vehicleIds) },
        select: {
          vehicleId: true,
          fittedAt: true,
          fittedOdometerKm: true,
          removedAt: true,
          removedOdometerKm: true,
        },
      }),
      this.tyreReadings.find({
        where: { tenantId, odometerKm: Not(IsNull()), tyre: { vehicleId: In(vehicleIds) } },
        relations: { tyre: true },
        select: { readingDate: true, odometerKm: true, tyre: { id: true, vehicleId: true } },
      }),
      this.batteryReadings.find({
        where: {
          tenantId,
          odometerKm: Not(IsNull()),
          batteryPack: { vehicleId: In(vehicleIds) },
        },
        relations: { batteryPack: true },
        select: {
          readingMonth: true,
          odometerKm: true,
          batteryPack: { id: true, vehicleId: true },
        },
      }),
    ]);

    return [
      ...jobs.map((job) => ({ vehicleId: job.vehicleId, at: job.openedAt, km: job.odometerKm! })),
      ...tyres.flatMap((tyre) => [
        { vehicleId: tyre.vehicleId, at: tyre.fittedAt, km: tyre.fittedOdometerKm },
        ...(tyre.removedAt && tyre.removedOdometerKm != null
          ? [{ vehicleId: tyre.vehicleId, at: tyre.removedAt, km: tyre.removedOdometerKm }]
          : []),
      ]),
      ...tyreReadings.map((reading) => ({
        vehicleId: reading.tyre.vehicleId,
        at: reading.readingDate,
        km: reading.odometerKm!,
      })),
      ...batteryReadings.map((reading) => ({
        vehicleId: reading.batteryPack.vehicleId,
        at: reading.readingMonth,
        km: reading.odometerKm!,
      })),
    ];
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

function scopedVehicleWhere(
  tenantId: string,
  filters: Pick<FleetAnalyticsFilters, 'heldAs' | 'truckTypeId' | 'vehicleId'>,
): FindOptionsWhere<VehicleEntity> {
  return {
    tenantId,
    deletedAt: IsNull(),
    status: In([...MAINTAINED_VEHICLE_STATUSES]),
    ownershipType: In(HELD_AS_OWNERSHIP[filters.heldAs]),
    ...(filters.truckTypeId ? { truckTypeId: filters.truckTypeId } : {}),
    ...(filters.vehicleId ? { id: filters.vehicleId } : {}),
  };
}
