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
  advancePercentage?: number; // defaults 30
  balancePercentage?: number; // defaults 70
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
