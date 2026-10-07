import { EntityManager } from 'typeorm';
import { TyreSetupGateway } from '../../masters/vehicle/gateways/tyre-setup.gateway';
import {
  InitialTyreSetInput,
  UpdateTyreSetInput,
  VehicleTyreSummary,
} from '../../masters/vehicle/vehicle.interface';
import { TyreService } from '../tyre.service';

/** Maintenance's side of masters' TyreSetupGateway — see that interface for why it's this way round. */
export class TyreSetupGatewayLocal implements TyreSetupGateway {
  constructor(private readonly tyreService: TyreService) {}

  fitInitialSet(
    tenantId: string,
    actorId: string,
    vehicle: { id: string; wheelCount: number | null; odometerKm: number | null },
    input: InitialTyreSetInput,
    manager: EntityManager,
  ): Promise<void> {
    return this.tyreService.fitInitialSet(tenantId, actorId, vehicle, input, manager);
  }

  updateTyreSet(
    tenantId: string,
    actorId: string,
    vehicle: { id: string; wheelCount: number | null; odometerKm: number | null },
    input: UpdateTyreSetInput,
    manager: EntityManager,
  ): Promise<void> {
    return this.tyreService.updateTyreSet(tenantId, actorId, vehicle, input, manager);
  }

  listFittedForVehicles(
    tenantId: string,
    vehicleIds: string[],
  ): Promise<Map<string, VehicleTyreSummary[]>> {
    return this.tyreService.listFittedSummaries(tenantId, vehicleIds);
  }
}
