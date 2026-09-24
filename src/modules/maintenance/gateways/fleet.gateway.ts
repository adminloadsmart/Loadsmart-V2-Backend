import { EntityManager } from 'typeorm';

/**
 * What maintenance needs to change on a vehicle — the dispatch coupling (FMS-MNT-000 acceptance
 * criterion 1) and the service clock. Every method takes the caller's transaction manager so the
 * vehicle change and the maintenance job commit or roll back together.
 */
export interface FleetGateway {
  /** Takes the truck out of dispatch. */
  placeMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void>;

  /** Puts the truck back in front of dispatch. */
  releaseMaintenanceHold(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void>;

  updateServiceUsage(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: {
      odometerKm?: number;
      lastServiceDate?: string;
      lastServiceOdometerKm?: number;
      serviceIntervalKm?: number;
      serviceIntervalMonths?: number;
    },
    manager?: EntityManager,
  ): Promise<void>;
}
