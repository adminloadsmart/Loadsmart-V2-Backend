/** One planned truck line on the "Plan Dispatch" screen (PRD §6.3). */
export interface OwnFleetTruckLineInput {
  sourceType: 'own_fleet';
  vehicleId: string;
}

export interface MarketTruckLineInput {
  sourceType: 'market';
  transporterId: string;
  truckTypeId: string;
  feetWheels?: string;
  capacityTonnes: number;
  numberOfTrucks: number;
}

export type TruckLineInput = OwnFleetTruckLineInput | MarketTruckLineInput;

export interface PlanDispatchInput {
  truckLines: TruckLineInput[];
}

export interface CapacitySummary {
  plannedTonnes: string;
  requisitionTonnes: string;
  remainingTonnes: string;
}
