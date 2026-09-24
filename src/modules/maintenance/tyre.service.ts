import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { toIstDateString } from '../../shared/utils/ist-time';
import { AuditService } from '../audit/audit.service';
import { TyreEntity } from './entities/tyre.entity';
import { TyreRepository } from './repositories/tyre.repository';
import { computeTyreWear } from './calculations/tyre-wear';
import {
  DEFAULT_MAX_RETREADS,
  LEGAL_TREAD_FLOOR_MM,
  TREAD_WARN_PCT,
} from './maintenance.constants';
import { FitTyreInput, RecordTyreReadingInput, RemoveTyreInput } from './maintenance.interface';
import { MaintenanceService } from './maintenance.service';
import { isUniqueViolation } from './utils/unique-violation';

function toTyreView(tyre: TyreEntity) {
  return {
    id: tyre.id,
    vehicleId: tyre.vehicleId,
    position: tyre.position,
    serialNumber: tyre.serialNumber,
    brand: tyre.brand,
    originalTreadMm: Number(tyre.originalTreadMm),
    fittedAt: tyre.fittedAt,
    fittedOdometerKm: tyre.fittedOdometerKm,
    retreadCount: tyre.retreadCount,
    maxRetreads: tyre.maxRetreads,
    casingCondition: tyre.casingCondition,
    status: tyre.status,
    removedAt: tyre.removedAt,
    removedOdometerKm: tyre.removedOdometerKm,
    removedReason: tyre.removedReason,
  };
}

export class TyreService {
  constructor(
    private readonly tyreRepository: TyreRepository,
    private readonly maintenanceService: MaintenanceService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The tyres queue — current state, not the period. Sorted by what runs out first (days to the
   * legal floor), not by what is most worn: only the first order is useful to somebody ordering
   * tyres. Positions already at the floor come first.
   *
   * `atLegalLimit` / `underThirtyPct` are counted from the same rows, so the headline agrees with
   * the queue behind it (acceptance criterion 3).
   */
  async listQueue(tenantId: string) {
    try {
      const today = toIstDateString(new Date());
      const tyres = await this.tyreRepository.listFitted(tenantId);
      const readings = await this.tyreRepository.latestReadings(
        tenantId,
        tyres.map((tyre) => tyre.id),
      );

      const rows = tyres.map((tyre) => {
        const reading = readings.get(tyre.id) ?? null;
        const wear = computeTyreWear({
          originalTreadMm: Number(tyre.originalTreadMm),
          fittedAt: tyre.fittedAt,
          fittedOdometerKm: tyre.fittedOdometerKm,
          vehicleOdometerKm: tyre.vehicle.serviceUsage?.odometerKm ?? null,
          latestReading: reading
            ? {
                treadMm: Number(reading.treadMm),
                readingDate: reading.readingDate,
                odometerKm: reading.odometerKm,
              }
            : null,
          retreadCount: tyre.retreadCount,
          maxRetreads: tyre.maxRetreads,
          casingCondition: tyre.casingCondition,
          today,
        });
        return { tyre, reading, wear };
      });

      const items = rows
        .filter((row) => row.wear.inQueue)
        .sort((a, b) => a.wear.daysToLegalFloor - b.wear.daysToLegalFloor)
        .map(({ tyre, reading, wear }) => ({
          tyreId: tyre.id,
          vehicle: { id: tyre.vehicle.id, registrationNumber: tyre.vehicle.registrationNumber },
          position: tyre.position,
          brand: tyre.brand,
          serialNumber: tyre.serialNumber,
          originalTreadMm: Number(tyre.originalTreadMm),
          lastReadingDate: reading?.readingDate ?? null,
          ...wear,
        }));

      return {
        legalFloorMm: LEGAL_TREAD_FLOOR_MM,
        legalBasis: 'Central Motor Vehicle Rules, 1989 — rule 94',
        warnBelowPct: TREAD_WARN_PCT,
        atLegalLimit: items.filter((item) => item.atLegalLimit).length,
        underThirtyPct: items.filter((item) => item.nearLimit).length,
        items,
        total: items.length,
      };
    } catch (error) {
      rethrow(error, 'Failed to list tyres');
    }
  }

  async fitTyre(tenantId: string, actorId: string, input: FitTyreInput) {
    try {
      const vehicle = await this.maintenanceService.assertOwnFleetVehicle(
        tenantId,
        input.vehicleId,
      );

      if (input.originalTreadMm <= LEGAL_TREAD_FLOOR_MM) {
        throw new ValidationError(
          `originalTreadMm must be above the legal floor of ${LEGAL_TREAD_FLOOR_MM}mm`,
        );
      }

      const position = input.position.trim().toUpperCase();
      const occupied = await this.tyreRepository.findFittedAt(tenantId, vehicle.id, position);
      if (occupied) {
        throw new ConflictError(
          `Position ${position} on ${vehicle.registrationNumber} already has a tyre fitted — remove it first`,
        );
      }

      const tyre = await this.tyreRepository.create({
        tenantId,
        vehicleId: vehicle.id,
        position,
        serialNumber: input.serialNumber ?? null,
        brand: input.brand ?? null,
        originalTreadMm: String(input.originalTreadMm),
        fittedAt: input.fittedAt ?? toIstDateString(new Date()),
        fittedOdometerKm: input.fittedOdometerKm ?? vehicle.serviceUsage?.odometerKm ?? 0,
        retreadCount: input.retreadCount ?? 0,
        maxRetreads: input.maxRetreads ?? DEFAULT_MAX_RETREADS,
        casingCondition: 'ok',
        createdBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'TYRE_FITTED',
        resourceType: 'tyre',
        newData: { id: tyre.id, vehicleId: vehicle.id, position },
      });

      return toTyreView(tyre);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('That position already has a tyre fitted');
      }
      rethrow(error, 'Failed to fit tyre');
    }
  }

  async recordReading(
    tenantId: string,
    actorId: string,
    tyreId: string,
    input: RecordTyreReadingInput,
  ) {
    try {
      const tyre = await this.assertFittedTyre(tenantId, tyreId);
      if (input.treadMm > Number(tyre.originalTreadMm)) {
        throw new ValidationError('treadMm cannot exceed the tyre’s original tread');
      }
      const readingDate = input.readingDate ?? toIstDateString(new Date());
      if (readingDate < tyre.fittedAt) {
        throw new ValidationError('readingDate cannot be before the tyre was fitted');
      }
      if (input.odometerKm !== undefined && input.odometerKm < tyre.fittedOdometerKm) {
        throw new ValidationError('odometerKm cannot be below the odometer at fitment');
      }

      const reading = await this.tyreRepository.createReading({
        tenantId,
        tyreId,
        treadMm: String(input.treadMm),
        readingDate,
        odometerKm: input.odometerKm ?? null,
        createdBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'TYRE_READING_RECORDED',
        resourceType: 'tyre',
        newData: { id: tyreId, treadMm: input.treadMm, readingDate },
      });

      return {
        id: reading.id,
        tyreId,
        treadMm: Number(reading.treadMm),
        readingDate: reading.readingDate,
        odometerKm: reading.odometerKm,
      };
    } catch (error) {
      rethrow(error, 'Failed to record tyre reading');
    }
  }

  /** Takes a tyre off its position — for retread, rotation or damage (`removed`) or scrap. */
  async removeTyre(tenantId: string, actorId: string, tyreId: string, input: RemoveTyreInput) {
    try {
      const tyre = await this.assertFittedTyre(tenantId, tyreId);
      const removedAt = input.removedAt ?? toIstDateString(new Date());
      if (removedAt < tyre.fittedAt) {
        throw new ValidationError('removedAt cannot be before the tyre was fitted');
      }

      const updated = await this.tyreRepository.update(tenantId, tyreId, {
        status: input.reason === 'scrap' ? 'scrapped' : 'removed',
        removedAt,
        removedOdometerKm: input.odometerKm ?? tyre.vehicle.serviceUsage?.odometerKm ?? null,
        removedReason: input.reason,
        ...(input.casingCondition ? { casingCondition: input.casingCondition } : {}),
        updatedBy: actorId,
      });

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'TYRE_REMOVED',
        resourceType: 'tyre',
        oldData: { id: tyreId, status: 'fitted', position: tyre.position },
        newData: { id: tyreId, status: updated!.status, reason: input.reason },
      });

      return toTyreView(updated!);
    } catch (error) {
      rethrow(error, 'Failed to remove tyre');
    }
  }

  private async assertFittedTyre(tenantId: string, tyreId: string): Promise<TyreEntity> {
    const tyre = await this.tyreRepository.findById(tenantId, tyreId);
    if (!tyre) throw new NotFoundError(`Tyre ${tyreId} not found`);
    if (tyre.status !== 'fitted') throw new ConflictError(`Tyre ${tyreId} is ${tyre.status}`);
    return tyre;
  }
}
