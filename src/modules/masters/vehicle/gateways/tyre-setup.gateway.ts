import { EntityManager } from 'typeorm';
import { InitialTyreSetInput, UpdateTyreSetInput, VehicleTyreSummary } from '../vehicle.interface';

/**
 * What onboarding needs from maintenance to switch on "Tyre life": fit a tyre at every position of
 * the new truck's layout. Maintenance already depends on masters (its FleetGateway), so masters
 * can't import TyreService — maintenance implements this instead and composition-root.ts hands it
 * to VehicleService.setTyreSetupGateway. Runs inside the onboarding transaction.
 */
export interface TyreSetupGateway {
  fitInitialSet(
    tenantId: string,
    actorId: string,
    vehicle: { id: string; wheelCount: number | null; odometerKm: number | null },
    input: InitialTyreSetInput,
    manager: EntityManager,
  ): Promise<void>;

  /** PATCH vehicle's `tyres` block — re-set or correct the fitted tyres, filling any empty
   *  position. Runs inside the vehicle update's transaction. */
  updateTyreSet(
    tenantId: string,
    actorId: string,
    vehicle: { id: string; wheelCount: number | null; odometerKm: number | null },
    input: UpdateTyreSetInput,
    manager: EntityManager,
  ): Promise<void>;

  /** The tyres currently fitted to each of these vehicles (keyed by vehicle id, positions in
   *  order), for the fleet list / detail / onboarding responses. One batched read — vehicles with
   *  no tyres on record are simply absent from the map. */
  listFittedForVehicles(
    tenantId: string,
    vehicleIds: string[],
  ): Promise<Map<string, VehicleTyreSummary[]>>;
}
