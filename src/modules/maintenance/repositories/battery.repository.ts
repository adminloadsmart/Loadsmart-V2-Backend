import { DataSource, In, IsNull, Repository } from 'typeorm';
import { BatteryPackEntity } from '../entities/battery-pack.entity';
import { BatterySohReadingEntity } from '../entities/battery-soh-reading.entity';
import { MAINTAINED_VEHICLE_STATUSES, OWN_FLEET_OWNERSHIP_TYPES } from '../maintenance.types';

export type CreateBatteryPackData = Omit<
  BatteryPackEntity,
  'id' | 'vehicle' | 'readings' | 'createdAt' | 'updatedAt' | 'updatedBy'
>;
export type CreateBatteryReadingData = Omit<
  BatterySohReadingEntity,
  'id' | 'batteryPack' | 'createdAt'
>;

export class BatteryRepository {
  private readonly packs: Repository<BatteryPackEntity>;
  private readonly readings: Repository<BatterySohReadingEntity>;

  constructor(dataSource: DataSource) {
    this.packs = dataSource.getRepository(BatteryPackEntity);
    this.readings = dataSource.getRepository(BatterySohReadingEntity);
  }

  createPack(data: CreateBatteryPackData): Promise<BatteryPackEntity> {
    return this.packs.save(this.packs.create(data));
  }

  findPackById(tenantId: string, id: string): Promise<BatteryPackEntity | null> {
    return this.packs.findOne({
      where: { id, tenantId },
      relations: { vehicle: true, readings: true },
    });
  }

  findReading(batteryPackId: string, readingMonth: string) {
    return this.readings.findOneBy({ batteryPackId, readingMonth });
  }

  createReading(data: CreateBatteryReadingData): Promise<BatterySohReadingEntity> {
    return this.readings.save(this.readings.create(data));
  }

  /** Every pack on a running own-fleet electric truck, with its full monthly SoH history. */
  listForOwnFleet(tenantId: string): Promise<BatteryPackEntity[]> {
    return this.packs.find({
      where: {
        tenantId,
        vehicle: {
          fuelType: 'electric',
          ownershipType: In([...OWN_FLEET_OWNERSHIP_TYPES]),
          status: In([...MAINTAINED_VEHICLE_STATUSES]),
          deletedAt: IsNull(),
        },
      },
      relations: { vehicle: { truckType: true }, readings: true },
    });
  }
}
