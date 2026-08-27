import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { VehicleService, resolveDocumentStatus } from '../masters/vehicle.service';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../masters/utils/vehicle.type';
import { ListVehiclesInput } from '../masters/utils/vehicle.interface';
import { TruckTypeService } from '../masters/truck-type.service';
import { TruckTypeEntity } from '../masters/entities/truck-type.entity';
import { RequisitionRepository } from './requisition.repository';
import { LoadRepository, CreateLoadData } from './load.repository';
import { CodeSequenceRepository } from './code-sequence.repository';
import { LoadActivityService } from './load-activity.service';
import { RequisitionEntity } from './entities/requisition.entity';
import { LoadEntity } from './entities/load.entity';
import { computeFitVerdict, FitResult } from './utils/fit-engine';
import { formatLoadCode } from './utils/code.util';
import {
  AvailableVehicleRow,
  CapacitySummary,
  ListAvailableVehiclesResult,
  MarketTruckLineInput,
  OwnFleetTruckLineInput,
  PlanDispatchInput,
  ProductAllocation,
  TruckLineFitVerdict,
  TruckLineInput,
} from './utils/dispatch-planning.interface';

const MIN_OVERRIDE_REASON_LENGTH = 15; // V-17

interface BuiltLine {
  rows: CreateLoadData[];
  cargoRows: { productId: string; tonnesPerTruck: string }[];
  capacityTonnes: number;
  fit: FitResult;
  /** vehicleId -> compliance warning, own-fleet lines only. */
  complianceWarnings: Map<string, string>;
}

export interface PlanDispatchResult {
  requisition: RequisitionEntity;
  loads: LoadEntity[];
  capacitySummary: CapacitySummary;
  allocationByProduct: ProductAllocation[];
  fitVerdicts: TruckLineFitVerdict[];
  complianceWarnings: { loadId: string; vehicleId: string; warning: string }[];
}

export class DispatchPlanningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requisitionRepository: RequisitionRepository,
    private readonly loadRepository: LoadRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly vehicleService: VehicleService,
    private readonly truckTypeService: TruckTypeService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Dispatch picks a requisition and plans how it moves: one line per planned truck (own fleet
   * or market), each carrying a mix of the requisition's products. On submit, the requisition is
   * split into loads — one load per truck (own-fleet lines are multi-vehicle: one load per
   * selected vehicle, all sharing the same cargo mix). Capacity under/over/exact are all allowed
   * at the requisition level; the summary is informational, not a hard block, so a requisition
   * can be dispatched in multiple rounds. Per-truck weight capacity IS a hard block (V-14).
   */
  async planDispatch(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    input: PlanDispatchInput,
  ): Promise<PlanDispatchResult> {
    try {
      if (!input.truckLines?.length) {
        throw new ValidationError('At least one truck line is required'); // V-16
      }

      return await this.dataSource.transaction(async (manager) => {
        const requisition = await this.requisitionRepository.findById(
          tenantId,
          requisitionId,
          manager,
        );
        if (!requisition) throw new ConflictError(`Requisition ${requisitionId} not found`);
        if (requisition.status === 'closed') {
          throw new ConflictError('Cannot plan dispatch against a closed requisition');
        }

        await this.assertVehicleChecks(tenantId, requisitionId, input, manager);

        const built: BuiltLine[] = [];
        for (const line of input.truckLines) {
          built.push(await this.buildRowsForLine(tenantId, actorId, requisitionId, line));
        }

        const allRows = built.flatMap((line) => line.rows);

        // REQ-nnnn-Lx — restarts at 1 per requisition and keeps counting across dispatch rounds
        // (a later partial-dispatch call against the same requisition continues from where the
        // previous one left off), same worked examples as Plan Dispatch v2.0. Sequential, not
        // Promise.all: each call takes a row lock on the same counter row, so awaiting one at a
        // time is both correct and no slower than they'd serialize to anyway.
        for (const row of allRows) {
          const loadSequenceValue = await this.codeSequenceRepository.next(
            'load',
            requisitionId,
            manager,
          );
          row.code = formatLoadCode(requisition.code, loadSequenceValue);
        }

        const loads = await this.loadRepository.createMany(allRows, manager);

        // Own-fleet lines take a vehicle off the yard and onto this load — reflect that on the
        // Fleet page immediately rather than leaving it "Idle" until someone edits it manually.
        // load.service.ts's closeLoad flips it back once the load is delivered/closed.
        for (const load of loads) {
          if (!load.vehicleId) continue;
          await this.vehicleService.setOperationalStatus(
            tenantId,
            actorId,
            load.vehicleId,
            { operationalStatus: 'on_trip', reason: `Assigned to load ${load.id}` },
            manager,
          );
        }

        // Cargo items + compliance warnings line up with `loads` in the same order `createMany`
        // preserves (repo.create/save keep array order).
        let cursor = 0;
        const complianceWarnings: PlanDispatchResult['complianceWarnings'] = [];
        for (const line of built) {
          for (let i = 0; i < line.rows.length; i++) {
            const load = loads[cursor++];
            await this.loadRepository.createCargoItems(
              line.cargoRows.map((cargo) => ({ tenantId, loadId: load.id, ...cargo })),
              manager,
            );
            if (load.vehicleId && line.complianceWarnings.has(load.vehicleId)) {
              complianceWarnings.push({
                loadId: load.id,
                vehicleId: load.vehicleId,
                warning: line.complianceWarnings.get(load.vehicleId)!,
              });
            }
          }
        }

        const plannedTonnes = built.reduce((sum, line) => sum + line.capacityTonnes, 0);
        const plannedTonnesStr = plannedTonnes.toFixed(2);
        await this.requisitionRepository.incrementDispatchedTonnes(
          tenantId,
          requisitionId,
          plannedTonnesStr,
          manager,
        );

        const newDispatchedTonnes = Number(requisition.dispatchedTonnes) + plannedTonnes;
        if (newDispatchedTonnes >= Number(requisition.quantityTonnes)) {
          await this.requisitionRepository.updateStatus(
            tenantId,
            requisitionId,
            'fully_dispatched',
            manager,
          );
        }

        for (const load of loads) {
          await this.loadActivityService.record(
            tenantId,
            load.id,
            actorId,
            'LOAD_CREATED',
            null,
            load.status,
            { requisitionId },
            manager,
          );
        }

        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'DISPATCH_PLANNED',
          resourceType: 'requisition',
          oldData: { id: requisitionId, dispatchedTonnes: requisition.dispatchedTonnes },
          newData: {
            id: requisitionId,
            dispatchedTonnes: newDispatchedTonnes.toFixed(2),
            loadsCreated: loads.length,
            ...(input.overrides?.length ? { overrides: input.overrides } : {}),
          },
        });

        const [updatedRequisition, allocationByProduct] = await Promise.all([
          this.requisitionRepository.findById(tenantId, requisitionId, manager),
          this.loadRepository.sumCargoByProductForRequisition(tenantId, requisitionId, manager),
        ]);

        return {
          requisition: updatedRequisition ?? requisition,
          loads,
          capacitySummary: {
            plannedTonnes: plannedTonnesStr,
            requisitionTonnes: requisition.quantityTonnes,
            remainingTonnes: (Number(requisition.quantityTonnes) - newDispatchedTonnes).toFixed(2),
          },
          allocationByProduct: (updatedRequisition?.items ?? requisition.items ?? []).map(
            (item) => ({
              productId: item.productId,
              plannedTonnes:
                allocationByProduct.find((row) => row.productId === item.productId)?.totalTonnes ??
                '0',
              requisitionTonnes: item.quantityTonnes,
            }),
          ),
          fitVerdicts: built.map((line, index) => ({ truckLineIndex: index, ...line.fit })),
          complianceWarnings,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to plan dispatch');
    }
  }

  /** C-01/C-02/C-03 — run once, up front, across every own-fleet vehicle in this call, before any
   *  row is built. Market lines carry no vehicle at planning time (R-16) so none of this applies
   *  to them. */
  private async assertVehicleChecks(
    tenantId: string,
    requisitionId: string,
    input: PlanDispatchInput,
    manager: EntityManager,
  ): Promise<void> {
    const ownFleetLines = input.truckLines.filter(
      (line): line is OwnFleetTruckLineInput => line.sourceType === 'own_fleet',
    );
    const allVehicleIds = ownFleetLines.flatMap((line) => line.vehicleIds);
    if (allVehicleIds.length === 0) return;

    // C-01a — repeated within this very call.
    const seen = new Set<string>();
    for (const vehicleId of allVehicleIds) {
      if (seen.has(vehicleId)) {
        throw new ConflictError(
          `Vehicle ${vehicleId} is planned on more than one truck line in this request`,
        );
      }
      seen.add(vehicleId);
    }

    // C-01b — already used by an existing load under this same requisition (earlier rounds).
    const inRequisition = await this.loadRepository.findByRequisitionAndVehicles(
      tenantId,
      requisitionId,
      allVehicleIds,
      manager,
    );
    if (inRequisition.length > 0) {
      throw new ConflictError(
        `Vehicle ${inRequisition[0].vehicleId} is already planned on load ${inRequisition[0].id} in this requisition`,
      );
    }

    // C-02 — the vehicle is on a live trip elsewhere in the tenant. No override possible.
    const active = await this.loadRepository.findActiveByVehicles(tenantId, allVehicleIds, manager);
    if (active.length > 0) {
      throw new ConflictError(
        `Vehicle ${active[0].vehicleId} is already on an active load elsewhere (load ${active[0].id}, status ${active[0].status})`,
      );
    }

    // C-03 — the vehicle appears on an earlier closed load. Amber: overridable with a reason.
    const closed = await this.loadRepository.findClosedByVehicles(tenantId, allVehicleIds, manager);
    if (closed.length > 0) {
      const override = input.overrides?.find((entry) => entry.checkId === 'C03');
      if (!override) {
        throw new ConflictError(
          `Vehicle ${closed[0].vehicleId} was used on an earlier closed load (${closed[0].id}) — override with a reason to reuse it`,
        );
      }
      if (override.reason.trim().length < MIN_OVERRIDE_REASON_LENGTH) {
        throw new ValidationError(
          `Override reason must be at least ${MIN_OVERRIDE_REASON_LENGTH} characters`, // V-17
        );
      }
    }
  }

  /** Dispatch Planning's vehicle picker — the base masters vehicle list, hard-filtered to
   *  status: 'active' (non-active vehicles can never be picked here — buildOwnFleetLine below
   *  rejects them outright), to operationalStatus !== 'on_trip', and to vehicles that would
   *  actually pass assertVehicleChecks' C-02/C-01b right now (not on an active load elsewhere,
   *  not already used in this requisition) — so only genuinely selectable vehicles come back. */
  async listAvailableVehicles(
    tenantId: string,
    requisitionId: string,
    filters: ListVehiclesInput,
  ): Promise<ListAvailableVehiclesResult> {
    try {
      const requisition = await this.requisitionRepository.findById(tenantId, requisitionId);
      if (!requisition) throw new NotFoundError(`Requisition ${requisitionId} not found`);

      const {
        items: fetchedVehicles,
        page,
        limit,
        total,
        totalPages,
      } = await this.vehicleService.listVehicles(tenantId, { ...filters, status: 'active' });

      const items = fetchedVehicles.filter(
        (vehicle) =>
          vehicle?.status !== 'inactive' &&
          vehicle.operationalStatus?.operationalStatus !== 'on_trip',
      );

      const vehicleIds = items.map((vehicle) => vehicle.id);
      const [activeElsewhere, inThisRequisition] = vehicleIds.length
        ? await Promise.all([
            this.loadRepository.findActiveByVehicles(tenantId, vehicleIds),
            this.loadRepository.findByRequisitionAndVehicles(tenantId, requisitionId, vehicleIds),
          ])
        : [[], []];
      const activeElsewhereIds = new Set(activeElsewhere.map((load) => load.vehicleId));
      const inThisRequisitionIds = new Set(inThisRequisition.map((load) => load.vehicleId));

      const rows: AvailableVehicleRow[] = items
        .map((vehicle): AvailableVehicleRow => {
          const unavailableReason = activeElsewhereIds.has(vehicle.id)
            ? 'on_active_load'
            : inThisRequisitionIds.has(vehicle.id)
              ? 'already_in_requisition'
              : null;
          return { ...vehicle, isAvailable: unavailableReason === null, unavailableReason };
        })
        .filter((row) => row.isAvailable);

      return { items: rows, page, limit, total, totalPages };
    } catch (error) {
      rethrow(error, 'Failed to list available vehicles');
    }
  }

  private async buildRowsForLine(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    line: TruckLineInput,
  ): Promise<BuiltLine> {
    const cargoTonnes = line.cargoMix.reduce((sum, item) => sum + item.tonnesPerTruck, 0);
    const cargoRows = line.cargoMix.map((item) => ({
      productId: item.productId,
      tonnesPerTruck: String(item.tonnesPerTruck),
    }));

    if (line.sourceType === 'own_fleet') {
      return this.buildOwnFleetLine(tenantId, actorId, requisitionId, line, cargoTonnes, cargoRows);
    }
    return this.buildMarketLine(tenantId, actorId, requisitionId, line, cargoTonnes, cargoRows);
  }

  private async buildOwnFleetLine(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    line: OwnFleetTruckLineInput,
    cargoTonnes: number,
    cargoRows: { productId: string; tonnesPerTruck: string }[],
  ): Promise<BuiltLine> {
    const complianceWarnings = new Map<string, string>();
    const documentTypesWithExpiry: readonly string[] = VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY;
    const capacities: number[] = [];
    const rows: CreateLoadData[] = [];

    for (const vehicleId of line.vehicleIds) {
      const vehicle = await this.vehicleService.getVehicle(tenantId, vehicleId);
      if (vehicle.status !== 'active') {
        throw new ConflictError(`Vehicle ${vehicleId} is not active`);
      }
      if (!vehicle.capacityTons) {
        throw new ValidationError(`Vehicle ${vehicleId} has no capacity set`);
      }
      capacities.push(Number(vehicle.capacityTons));

      const expired = (vehicle.documents ?? [])
        .filter((document) => documentTypesWithExpiry.includes(document.documentType))
        .some((document) => resolveDocumentStatus(document.expiryDate) === 'expired');
      if (expired) {
        complianceWarnings.set(
          vehicleId,
          'This vehicle has one or more expired compliance documents (e.g. insurance/PUC/fitness). ' +
            'You can still assign it, but please verify before dispatch.',
        );
      }

      // Vehicle+driver already known — the load lands directly in `assigned` (R-35), skipping the
      // Load Assignment step entirely for own-fleet.
      const primaryLink = (vehicle.driverLinks ?? []).find(
        (link) => link.isPrimary && link.status === 'active',
      );

      rows.push({
        tenantId,
        requisitionId,
        sourceType: 'own_fleet',
        status: 'assigned',
        plannedCapacityTonnes: vehicle.capacityTons,
        vehicleId: vehicle.id,
        vehicleNumber: vehicle.registrationNumber,
        driverId: primaryLink?.driverId ?? null,
        driverNumber: primaryLink?.driver?.phoneNumber ?? null,
        createdBy: actorId,
      });
    }

    const minCapacity = Math.min(...capacities);
    if (cargoTonnes > minCapacity) {
      throw new ValidationError(
        `Cargo mix (${cargoTonnes}t) exceeds the smallest selected vehicle's capacity (${minCapacity}t)`, // V-14
      );
    }

    const fit = computeFitVerdict(cargoTonnes, minCapacity, false);

    return {
      rows,
      cargoRows,
      capacityTonnes: cargoTonnes * line.vehicleIds.length,
      fit,
      complianceWarnings,
    };
  }

  private async buildMarketLine(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    line: MarketTruckLineInput,
    cargoTonnes: number,
    cargoRows: { productId: string; tonnesPerTruck: string }[],
  ): Promise<BuiltLine> {
    const truckType = await this.truckTypeService.assertTruckTypeExists(tenantId, line.truckTypeId);
    if (!truckType.capacityTons) {
      throw new ValidationError(
        `Truck type "${truckType.name}" has no capacity set — edit it in Settings → Truck Types first`,
      );
    }

    const capacityTons = Number(truckType.capacityTons);
    if (cargoTonnes > capacityTons) {
      throw new ValidationError(
        `Cargo mix (${cargoTonnes}t) exceeds this truck type's capacity (${capacityTons}t)`, // V-14
      );
    }

    const smallerFit = await this.findSmallerFitSuggestion(tenantId, truckType, cargoTonnes);
    const fit = computeFitVerdict(cargoTonnes, capacityTons, smallerFit !== null);

    // Balance isn't a client input — Plan Dispatch v2.0 §6.3/§6.4: "Balance is calculated
    // automatically as 100 minus advance."
    const advancePercentage = line.advancePercentage ?? 30;

    const row: CreateLoadData = {
      tenantId,
      requisitionId,
      sourceType: 'market',
      status: 'created',
      plannedCapacityTonnes: truckType.capacityTons,
      truckTypeId: truckType.id,
      feetWheels: truckType.wheelConfiguration ? `${truckType.wheelConfiguration} WH` : null,
      freightMode: line.freightMode,
      expectedRate: line.expectedRate === undefined ? null : String(line.expectedRate),
      advancePercentage: String(advancePercentage),
      balancePercentage: String(100 - advancePercentage),
      createdBy: actorId,
    };

    return {
      rows: Array.from({ length: line.numberOfTrucks }, () => ({ ...row })),
      cargoRows,
      capacityTonnes: cargoTonnes * line.numberOfTrucks,
      fit,
      complianceWarnings: new Map(),
    };
  }

  /** Market only — "a smaller vehicle would do this job" (§6.7). Own-fleet has no catalog to
   *  suggest from, so this is never called for own-fleet lines. */
  private async findSmallerFitSuggestion(
    tenantId: string,
    truckType: TruckTypeEntity,
    cargoTonnes: number,
  ) {
    if (!truckType.bodyType || !truckType.capacityTons) return null;
    return this.truckTypeService.findSmallerFit(
      tenantId,
      truckType.bodyType,
      String(cargoTonnes),
      truckType.capacityTons,
    );
  }
}
