import { DataSource } from 'typeorm';
import { ConflictError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { VehicleService } from '../masters/vehicle.service';
import { TransporterService } from '../masters/transporter.service';
import { TruckTypeService } from '../masters/truck-type.service';
import { RequisitionRepository } from './requisition.repository';
import { LoadRepository, CreateLoadData } from './load.repository';
import { LoadActivityService } from './load-activity.service';
import { RequisitionEntity } from './entities/requisition.entity';
import { LoadEntity } from './entities/load.entity';
import {
  CapacitySummary,
  PlanDispatchInput,
  TruckLineInput,
} from './utils/dispatch-planning.interface';

export class DispatchPlanningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requisitionRepository: RequisitionRepository,
    private readonly loadRepository: LoadRepository,
    private readonly vehicleService: VehicleService,
    private readonly transporterService: TransporterService,
    private readonly truckTypeService: TruckTypeService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Dispatch picks a requisition and plans how it moves: one line per planned truck
   * (own fleet or market). On submit, the requisition is split into loads — one load per truck
   * (FMS-DSP-R003). Capacity under/over/exact are all allowed (FMS-DSP-R001/R002); the summary is
   * informational, not a hard block, so a requisition can be dispatched in multiple rounds.
   */
  async planDispatch(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    input: PlanDispatchInput,
  ): Promise<{
    requisition: RequisitionEntity;
    loads: LoadEntity[];
    capacitySummary: CapacitySummary;
  }> {
    try {
      if (!input.truckLines?.length) {
        throw new ValidationError('At least one truck line is required');
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

        const rows: CreateLoadData[] = [];
        let plannedTonnes = 0;

        for (const line of input.truckLines) {
          const lineRows = await this.buildRowsForLine(tenantId, actorId, requisitionId, line);
          rows.push(...lineRows.rows);
          plannedTonnes += lineRows.capacityTonnes;
        }

        const loads = await this.loadRepository.createMany(rows, manager);

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
            'created',
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
          },
        });

        const updatedRequisition = await this.requisitionRepository.findById(
          tenantId,
          requisitionId,
          manager,
        );

        return {
          requisition: updatedRequisition ?? requisition,
          loads,
          capacitySummary: {
            plannedTonnes: plannedTonnesStr,
            requisitionTonnes: requisition.quantityTonnes,
            remainingTonnes: (Number(requisition.quantityTonnes) - newDispatchedTonnes).toFixed(2),
          },
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to plan dispatch');
    }
  }

  private async buildRowsForLine(
    tenantId: string,
    actorId: string,
    requisitionId: string,
    line: TruckLineInput,
  ): Promise<{ rows: CreateLoadData[]; capacityTonnes: number }> {
    if (line.sourceType === 'own_fleet') {
      const vehicle = await this.vehicleService.getVehicle(tenantId, line.vehicleId);
      if (vehicle.status !== 'active') {
        throw new ConflictError(`Vehicle ${line.vehicleId} is not active`);
      }
      if (!vehicle.capacityTons) {
        throw new ValidationError(`Vehicle ${line.vehicleId} has no capacity set`);
      }

      const row: CreateLoadData = {
        tenantId,
        requisitionId,
        sourceType: 'own_fleet',
        plannedCapacityTonnes: vehicle.capacityTons,
        vehicleId: vehicle.id,
        createdBy: actorId,
      };
      return { rows: [row], capacityTonnes: Number(vehicle.capacityTons) };
    }

    await this.transporterService.getTransporter(tenantId, line.transporterId);
    await this.truckTypeService.assertTruckTypeExists(tenantId, line.truckTypeId);

    const row: CreateLoadData = {
      tenantId,
      requisitionId,
      sourceType: 'market',
      plannedCapacityTonnes: String(line.capacityTonnes),
      truckTypeId: line.truckTypeId,
      feetWheels: line.feetWheels ?? null,
      transporterId: line.transporterId,
      createdBy: actorId,
    };
    return {
      rows: Array.from({ length: line.numberOfTrucks }, () => ({ ...row })),
      capacityTonnes: line.capacityTonnes * line.numberOfTrucks,
    };
  }
}
