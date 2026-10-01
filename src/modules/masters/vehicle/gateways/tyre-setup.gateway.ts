import { EntityManager } from 'typeorm';
import { InitialTyreSetInput } from '../vehicle.interface';

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
}
