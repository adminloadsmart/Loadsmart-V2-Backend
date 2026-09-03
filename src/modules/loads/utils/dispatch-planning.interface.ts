import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { Paginated } from '../../../shared/utils/pagination';
import { FitVerdict, FreightMode } from './loads.types';
import { OverrideInput } from './override.interface';

/** What one truck of this line carries — the "cargo mix" (Plan Dispatch v2.0 R-08), identical
 *  across every load the line spawns. */
export interface CargoMixLineInput {
  productId: string;
  tonnesPerTruck: number;
}

/** One planned truck line on the "Plan Dispatch" screen. Own-fleet is multi-vehicle: selecting
 *  several vehicles creates one load per vehicle, all sharing the same cargo mix (R-06/"each
 *  vehicle... same cargo mix"). */
export interface OwnFleetTruckLineInput {
  sourceType: 'own_fleet';
  vehicleIds: string[];
  cargoMix: CargoMixLineInput[];
}

export interface MarketTruckLineInput {
  sourceType: 'market';
  truckTypeId: string;
  numberOfTrucks: number;
  cargoMix: CargoMixLineInput[];
  /** Captured at planning (R-16) — the transporter, vehicle number, driver and *agreed* rate are
   *  still captured later at Assignment. */
  freightMode: FreightMode;
  expectedRate?: number; // required iff freightMode === 'set_expected_price'
  /** Balance isn't a separate input — Plan Dispatch v2.0 §6.3/§6.4: "Balance is calculated
   *  automatically as 100 minus advance." Defaults 30 (balance defaults to 70). */
  advancePercentage?: number;
}

export type TruckLineInput = OwnFleetTruckLineInput | MarketTruckLineInput;

export interface PlanDispatchInput {
  truckLines: TruckLineInput[];
  /** C-01/C-02 never accept an override; C-03 (a vehicle used on an earlier closed load) is the
   *  only overridable check at this stage. */
  overrides?: OverrideInput[];
}

export interface CapacitySummary {
  plannedTonnes: string;
  requisitionTonnes: string;
  remainingTonnes: string;
}

export interface ProductAllocation {
  productId: string;
  plannedTonnes: string;
  requisitionTonnes: string;
}

export interface TruckLineFitVerdict {
  truckLineIndex: number;
  verdict: FitVerdict;
  weightUtilizationPercent: number;
}

/** One row of the Dispatch Planning vehicle picker — a vehicle plus whether it can actually be
 *  put on this requisition right now. The underlying query is hard-filtered to status: 'active'
 *  (see DispatchPlanningService.listAvailableVehicles), so only the two dispatch-planning
 *  conflict checks can still block one: C-02 (on a live trip elsewhere), then C-01b (already
 *  used earlier in this requisition). null once neither applies. */
export interface AvailableVehicleRow extends VehicleEntity {
  isAvailable: boolean;
  unavailableReason: 'on_active_load' | 'already_in_requisition' | null;
}

export type ListAvailableVehiclesResult = Paginated<AvailableVehicleRow>;
