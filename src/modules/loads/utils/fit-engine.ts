import { FitVerdict } from './loads.types';

export interface FitResult {
  verdict: FitVerdict;
  weightUtilizationPercent: number;
}

// Plan Dispatch v2.0 §6.7's thresholds. Deck-volume/"cubes out" is deferred (see the Load module
// plan's scope decision — ProductEntity.dimensions is an unstructured string, not per-axis
// numbers, so a reliable required-deck-volume figure can't be computed yet); this is weight only.
const GOOD_FIT_THRESHOLD = 0.85;
const UNDERUSED_THRESHOLD = 0.6;

/**
 * Pure, unit-testable — never blocks (the capacity check that DOES block, cargo ≤ truck capacity,
 * lives in dispatch-planning.service.ts before this ever runs). `hasSmallerFit` is resolved by the
 * caller (masters/truck-type/truck-type.service.ts's findSmallerFit, market only — own-fleet has no catalog
 * to suggest from) since it needs a DB lookup this pure function shouldn't own.
 */
export function computeFitVerdict(
  cargoTonnes: number,
  truckCapacityTons: number,
  hasSmallerFit: boolean,
): FitResult {
  const weightUtilizationPercent =
    truckCapacityTons > 0 ? (cargoTonnes / truckCapacityTons) * 100 : 0;
  const utilizationRatio = weightUtilizationPercent / 100;

  const verdict: FitVerdict =
    utilizationRatio >= GOOD_FIT_THRESHOLD
      ? 'good_fit'
      : utilizationRatio >= UNDERUSED_THRESHOLD || !hasSmallerFit
        ? 'some_unused_capacity'
        : 'smaller_vehicle_available';

  return { verdict, weightUtilizationPercent: Math.round(weightUtilizationPercent * 100) / 100 };
}
