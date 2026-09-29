import { EntityManager } from 'typeorm';
import { VehicleService } from '../../masters/vehicle/vehicle.service';
import { FleetGateway } from './fleet.gateway';

export class FleetGatewayLocal implements FleetGateway {
  constructor(private readonly vehicleService: VehicleService) {}

  placeMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    return this.vehicleService.placeMaintenanceHold(tenantId, actorId, vehicleId, reason, manager);
  }

  releaseMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    return this.vehicleService.releaseMaintenanceHold(
      tenantId,
      actorId,
      vehicleId,
      reason,
      manager,
    );
  }

  async updateServiceUsage(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: Parameters<FleetGateway['updateServiceUsage']>[3],
    manager?: EntityManager,
  ): Promise<void> {
    await this.vehicleService.setServiceUsage(tenantId, actorId, vehicleId, input, manager);
  }
}
