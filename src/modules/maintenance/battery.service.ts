import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { BatteryRepository } from './repositories/battery.repository';
import { computeBatterySoh } from './calculations/battery-soh';
import { firstOfMonth } from './calculations/dates';
import { DEFAULT_BATTERY_WARRANTY_SOH_FLOOR_PCT } from './maintenance.constants';
import { BatteryVerdict } from './maintenance.types';
import { RecordBatteryReadingInput, RegisterBatteryPackInput } from './maintenance.interface';
import { MaintenanceService } from './maintenance.service';
import { isUniqueViolation } from './utils/unique-violation';
import { toVehicleSummary } from './maintenance.views';

/** capital_call first (the shipper's money), then warranty claims, then packs we can't call yet. */
const VERDICT_ORDER: Record<BatteryVerdict, number> = {
  capital_call: 0,
  manufacturer: 1,
  insufficient_data: 2,
};

export class BatteryService {
  constructor(
    private readonly batteryRepository: BatteryRepository,
    private readonly maintenanceService: MaintenanceService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The batteries queue — one row per pack on an own-fleet electric truck, current state. A
   * diesel engine is repaired; a pack is replaced once, for close to the price of a used truck —
   * so each row answers whether its pack crosses the warranty floor before or after the warranty
   * ends (see computeBatterySoh).
   */
  async listQueue(tenantId: string) {
    try {
      const packs = await this.batteryRepository.listForOwnFleet(tenantId);

      const items = packs
        .map((pack) => {
          const floorPct = Number(pack.warrantySohFloorPct);
          const soh = computeBatterySoh({
            readings: pack.readings.map((r) => ({
              readingMonth: r.readingMonth,
              sohPct: Number(r.sohPct),
            })),
            floorPct,
            warrantyEnd: pack.warrantyEnd,
          });
          return {
            packId: pack.id,
            vehicle: toVehicleSummary(pack.vehicle),
            serialNumber: pack.serialNumber,
            capacityKwh: pack.capacityKwh === null ? null : Number(pack.capacityKwh),
            warrantyStart: pack.warrantyStart,
            warrantyEnd: pack.warrantyEnd,
            warrantySohFloorPct: floorPct,
            ...soh,
          };
        })
        .sort(
          (a, b) =>
            VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
            (a.floorReachedOn ?? '9999').localeCompare(b.floorReachedOn ?? '9999'),
        );

      return {
        items,
        total: items.length,
        capitalCalls: items.filter((item) => item.verdict === 'capital_call').length,
      };
    } catch (error) {
      rethrow(error, 'Failed to list batteries');
    }
  }

  async registerPack(tenantId: string, actorId: string, input: RegisterBatteryPackInput) {
    try {
      const vehicle = await this.maintenanceService.assertOwnFleetVehicle(
        tenantId,
        input.vehicleId,
      );
      if (vehicle.fuelType !== 'electric') {
        throw new ValidationError(`${vehicle.registrationNumber} is not an electric vehicle`);
      }
      if (input.warrantyEnd <= input.warrantyStart) {
        throw new ValidationError('warrantyEnd must be after warrantyStart');
      }

      const pack = await this.batteryRepository.createPack({
        tenantId,
        vehicleId: vehicle.id,
        serialNumber: input.serialNumber ?? null,
        capacityKwh: input.capacityKwh === undefined ? null : String(input.capacityKwh),
        warrantyStart: input.warrantyStart,
        warrantyEnd: input.warrantyEnd,
        warrantySohFloorPct: String(
          input.warrantySohFloorPct ?? DEFAULT_BATTERY_WARRANTY_SOH_FLOOR_PCT,
        ),
        createdBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'BATTERY_PACK_REGISTERED',
        resourceType: 'battery_pack',
        newData: { id: pack.id, vehicleId: vehicle.id },
      });

      return {
        id: pack.id,
        vehicleId: pack.vehicleId,
        serialNumber: pack.serialNumber,
        capacityKwh: pack.capacityKwh === null ? null : Number(pack.capacityKwh),
        warrantyStart: pack.warrantyStart,
        warrantyEnd: pack.warrantyEnd,
        warrantySohFloorPct: Number(pack.warrantySohFloorPct),
      };
    } catch (error) {
      rethrow(error, 'Failed to register battery pack');
    }
  }

  async recordReading(
    tenantId: string,
    actorId: string,
    packId: string,
    input: RecordBatteryReadingInput,
  ) {
    try {
      const pack = await this.batteryRepository.findPackById(tenantId, packId);
      if (!pack) throw new NotFoundError(`Battery pack ${packId} not found`);

      const readingMonth = firstOfMonth(input.readingMonth);
      if (await this.batteryRepository.findReading(packId, readingMonth)) {
        throw new ConflictError(`A reading for ${readingMonth.slice(0, 7)} already exists`);
      }

      const reading = await this.batteryRepository.createReading({
        tenantId,
        batteryPackId: packId,
        readingMonth,
        sohPct: String(input.sohPct),
        odometerKm: input.odometerKm ?? null,
        createdBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'BATTERY_SOH_RECORDED',
        resourceType: 'battery_pack',
        newData: { id: packId, readingMonth, sohPct: input.sohPct },
      });

      return {
        id: reading.id,
        packId,
        readingMonth: reading.readingMonth,
        sohPct: Number(reading.sohPct),
        odometerKm: reading.odometerKm,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A reading for that month already exists');
      }
      rethrow(error, 'Failed to record battery reading');
    }
  }
}
