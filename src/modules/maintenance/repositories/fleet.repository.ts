import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { VehicleFuelType } from '../../masters/vehicle/vehicle.type';
import { LoadEntity } from '../../loads/entities/load.entity';
import { MAINTAINED_VEHICLE_STATUSES, OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance.types';

/**
 * Read side of the vehicles and loads maintenance depends on — reads VehicleEntity/LoadEntity
 * directly, same as DashboardsRepository and the analytics/* modules. Writes to the vehicle go
 * through FleetGateway (VehicleService), never here.
 */
export class MaintenanceFleetRepository {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly loads: Repository<LoadEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.loads = dataSource.getRepository(LoadEntity);
  }

  /** Any non-deleted vehicle, own fleet or not — callers decide how to reject attached ones. */
  findVehicle(
    tenantId: string,
    vehicleId: string,
    manager?: EntityManager,
  ): Promise<VehicleEntity | null> {
    const repo = manager?.getRepository(VehicleEntity) ?? this.vehicles;
    return repo.findOne({
      where: { id: vehicleId, tenantId, deletedAt: IsNull() },
      relations: { serviceUsage: true, telemetryMeta: true, truckType: true },
    });
  }

  /** The running own fleet — owned/leased, onboarded and not retired — with what every queue
   *  row shows (class) and what decides its dispatch effect (papers). */
  listOwnFleet(tenantId: string, filters: { fuelType?: VehicleFuelType } = {}) {
    return this.vehicles.find({
      where: {
        tenantId,
        deletedAt: IsNull(),
        ownershipType: In([...OWN_FLEET_OWNERSHIP_TYPES]),
        status: In([...MAINTAINED_VEHICLE_STATUSES]),
        ...(filters.fuelType ? { fuelType: filters.fuelType } : {}),
      },
      relations: { serviceUsage: true, telemetryMeta: true, truckType: true, documents: true },
      order: { registrationNumber: 'ASC' },
    });
  }

  /** Open market loads (not yet delivered/closed) bought to cover each of these trucks. */
  async countOpenMarketLoadsCovering(
    tenantId: string,
    vehicleIds: string[],
  ): Promise<Map<string, number>> {
    if (vehicleIds.length === 0) return new Map();

    const rows = await this.loads
      .createQueryBuilder('load')
      .select('load.covers_vehicle_id', 'vehicleId')
      .addSelect('COUNT(*)::int', 'count')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere("load.source_type = 'market'")
      .andWhere('load.covers_vehicle_id IN (:...vehicleIds)', { vehicleIds })
      .andWhere('load.status NOT IN (:...done)', { done: ['delivered', 'closed'] })
      .groupBy('load.covers_vehicle_id')
      .getRawMany<{ vehicleId: string; count: number }>();

    return new Map(rows.map((row) => [row.vehicleId, Number(row.count)]));
  }
}
