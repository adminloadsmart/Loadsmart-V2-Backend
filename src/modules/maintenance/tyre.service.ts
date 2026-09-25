import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { toIstDateString } from '../../shared/utils/ist-time';
import { AuditService } from '../audit/audit.service';
import { TyreEntity } from './entities/tyre.entity';
import { TyreRepository } from './repositories/tyre.repository';
import { MaintenanceJobRepository } from './repositories/maintenance-job.repository';
import { tyrePositions } from './calculations/tyre-layout';
import { TyreReadingEntity } from './entities/tyre-reading.entity';
import { computeTyreWear } from './calculations/tyre-wear';
import {
  DEFAULT_MAX_RETREADS,
  DEFAULT_NEW_TYRE_TREAD_MM,
  DEFAULT_RETREAD_TREAD_MM,
  LEGAL_TREAD_FLOOR_MM,
  TREAD_WARN_PCT,
} from './maintenance.constants';
import {
  Actor,
  FitTyreInput,
  RecordTyreReadingInput,
  RecordTyreWorkInput,
  RemoveTyreInput,
} from './maintenance.interface';
import { blankJob, MaintenanceService } from './maintenance.service';
import { toJobView, toVehicleSummary } from './maintenance.views';
import { isUniqueViolation } from './utils/unique-violation';

function toTyreView(tyre: TyreEntity) {
  return {
    id: tyre.id,
    vehicleId: tyre.vehicleId,
    position: tyre.position,
    serialNumber: tyre.serialNumber,
    brand: tyre.brand,
    sizeCode: tyre.sizeCode,
    maintenanceJobId: tyre.maintenanceJobId,
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
    private readonly dataSource: DataSource,
    private readonly tyreRepository: TyreRepository,
    private readonly jobRepository: MaintenanceJobRepository,
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
        const wear = wearOf(tyre, reading, tyre.vehicle.serviceUsage?.odometerKm ?? null, today);
        return { tyre, reading, wear };
      });

      const items = rows
        .filter((row) => row.wear.inQueue)
        .sort((a, b) => a.wear.daysToLegalFloor - b.wear.daysToLegalFloor)
        .map(({ tyre, reading, wear }) => ({
          tyreId: tyre.id,
          vehicle: toVehicleSummary(tyre.vehicle),
          position: tyre.position,
          brand: tyre.brand,
          sizeCode: tyre.sizeCode,
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

  /**
   * One truck's axle diagram: every position its wheel count gives (FL, FR, R1L, …), what is
   * fitted there with its wear, and the odometer to prefill Record Tyre Maintenance with. Tyres
   * fitted at a position outside the standard layout are appended so none go missing.
   */
  async getVehicleTyres(tenantId: string, vehicleId: string) {
    try {
      const vehicle = await this.maintenanceService.assertOwnFleetVehicle(tenantId, vehicleId);
      const today = toIstDateString(new Date());
      const odometerKm = vehicle.serviceUsage?.odometerKm ?? null;
      const fitted = await this.tyreRepository.listFittedForVehicle(tenantId, vehicle.id);
      const readings = await this.tyreRepository.latestReadings(
        tenantId,
        fitted.map((tyre) => tyre.id),
      );
      const byPosition = new Map(fitted.map((tyre) => [tyre.position, tyre]));
      const layout = tyrePositions(vehicle.wheelCount);
      const positions = [
        ...layout,
        ...fitted.map((t) => t.position).filter((p) => !layout.includes(p)),
      ];

      return {
        vehicle: toVehicleSummary(vehicle),
        wheelCount: vehicle.wheelCount,
        odometerKm,
        positions: positions.map((position) => {
          const tyre = byPosition.get(position);
          if (!tyre) return { position, tyre: null };
          const reading = readings.get(tyre.id) ?? null;
          return {
            position,
            tyre: {
              ...toTyreView(tyre),
              lastReadingDate: reading?.readingDate ?? null,
              ...wearOf(tyre, reading, odometerKm, today),
            },
          };
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to read vehicle tyres');
    }
  }

  /**
   * Record Tyre Maintenance — one invoice across one or more positions, as a closed `tyre` job
   * carrying the cost (so it reaches the spend headline) with a fresh fitment per position:
   *  - new_fitment: the tyre on the position (if any) comes off as `replaced`; a new tyre goes on.
   *  - cold_retread: the fitted casing comes off as `retread` and goes back on remoulded, same
   *    serial, retread_count + 1 — refused if the casing is damaged or out of retreads.
   * All positions or none. Recorded after the fact, so dispatch is untouched.
   */
  async recordTyreWork(
    tenantId: string,
    actor: Actor,
    input: RecordTyreWorkInput,
    canSeeCosts: boolean,
  ) {
    try {
      const vehicle = await this.maintenanceService.assertOwnFleetVehicle(
        tenantId,
        input.vehicleId,
      );
      await this.maintenanceService.assertInvoice(tenantId, actor, input);
      const at = this.maintenanceService.resolveDate(input.invoiceDate, 'invoiceDate');

      const positions = input.positions.map((position) => position.trim().toUpperCase());
      if (new Set(positions).size !== positions.length) {
        throw new ValidationError('Each position can be selected only once');
      }
      const layout = tyrePositions(vehicle.wheelCount);
      const unknown = positions.filter((position) => !layout.includes(position));
      if (vehicle.wheelCount && unknown.length > 0) {
        throw new ValidationError(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a wheel position on a ${vehicle.wheelCount}-wheel truck (${layout.join(', ')})`,
        );
      }

      const job = await this.dataSource.transaction(async (manager) => {
        const created = await this.jobRepository.create(
          {
            ...blankJob(tenantId, vehicle.id, actor.id),
            jobType: 'tyre',
            status: 'closed',
            openedAt: at,
            closedAt: at,
            odometerKm: input.odometerKm,
            workshopName: input.workshopName,
            description: `${input.action === 'cold_retread' ? 'Cold retread' : 'New tyre fitment'} — ${positions.join(', ')}`,
            invoiceFileKey: input.invoiceFileKey ?? null,
            totalCost: String(input.totalCost),
          },
          manager,
        );

        for (const position of positions) {
          await this.refitPosition(manager, tenantId, actor.id, vehicle.registrationNumber, {
            vehicleId: vehicle.id,
            position,
            jobId: created.id,
            input,
          });
        }

        await this.maintenanceService.raiseOdometer(
          manager,
          tenantId,
          actor.id,
          vehicle.id,
          input.odometerKm,
        );

        await this.auditService.log(
          {
            tenantId,
            userId: actor.id,
            action: 'MAINTENANCE_TYRE_WORK_RECORDED',
            resourceType: 'maintenance_job',
            newData: {
              id: created.id,
              vehicleId: vehicle.id,
              action: input.action,
              positions,
              totalCost: input.totalCost,
            },
          },
          manager,
        );

        return this.jobRepository.findById(tenantId, created.id, manager);
      });

      return {
        job: toJobView(job!, canSeeCosts),
        action: input.action,
        positions,
        tyres: (job!.tyres ?? []).map(toTyreView),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A selected position changed while saving — try again');
      }
      rethrow(error, 'Failed to record tyre maintenance');
    }
  }

  /** One position of a Record Tyre Maintenance entry — take off what is there, fit the new one. */
  private async refitPosition(
    manager: EntityManager,
    tenantId: string,
    actorId: string,
    registrationNumber: string,
    target: { vehicleId: string; position: string; jobId: string; input: RecordTyreWorkInput },
  ) {
    const { vehicleId, position, jobId, input } = target;
    const fittedAt = input.invoiceDate;
    const current = await this.tyreRepository.findFittedAt(tenantId, vehicleId, position, manager);

    if (input.action === 'cold_retread') {
      if (!current) {
        throw new ConflictError(
          `${position} on ${registrationNumber} has no tyre fitted to retread — record a new fitment`,
        );
      }
      if (current.casingCondition === 'damaged') {
        throw new ConflictError(`${position}: the casing is damaged and can't be retreaded`);
      }
      if (current.retreadCount >= current.maxRetreads) {
        throw new ConflictError(
          `${position}: the casing has already been retreaded ${current.retreadCount} time(s), its limit`,
        );
      }
    }
    if (current && fittedAt < current.fittedAt) {
      throw new ValidationError(`invoiceDate is before the tyre at ${position} was fitted`);
    }

    if (current) {
      await this.tyreRepository.update(
        tenantId,
        current.id,
        {
          status: 'removed',
          removedAt: fittedAt,
          removedOdometerKm: input.odometerKm,
          removedReason: input.action === 'cold_retread' ? 'retread' : 'replaced',
          updatedBy: actorId,
        },
        manager,
      );
    }

    const retread = input.action === 'cold_retread' && current;
    await this.tyreRepository.create(
      {
        tenantId,
        vehicleId,
        position,
        serialNumber: retread ? current.serialNumber : null,
        brand: input.brand,
        sizeCode: input.sizeCode ?? (retread ? current.sizeCode : null),
        maintenanceJobId: jobId,
        originalTreadMm: String(
          input.originalTreadMm ?? (retread ? DEFAULT_RETREAD_TREAD_MM : DEFAULT_NEW_TYRE_TREAD_MM),
        ),
        fittedAt,
        fittedOdometerKm: input.odometerKm,
        retreadCount: retread ? current.retreadCount + 1 : 0,
        maxRetreads: retread ? current.maxRetreads : DEFAULT_MAX_RETREADS,
        casingCondition: 'ok',
        createdBy: actorId,
      },
      manager,
    );
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
        sizeCode: null,
        maintenanceJobId: null,
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

function wearOf(
  tyre: TyreEntity,
  reading: TyreReadingEntity | null,
  vehicleOdometerKm: number | null,
  today: string,
) {
  return computeTyreWear({
    originalTreadMm: Number(tyre.originalTreadMm),
    fittedAt: tyre.fittedAt,
    fittedOdometerKm: tyre.fittedOdometerKm,
    vehicleOdometerKm,
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
}
