import { resolveIndianState } from '../../../shared/constants/indian-states';

export interface LaneParts {
  pickupCity: string;
  pickupState: string;
  dropCity: string;
  dropState: string;
}

/** Trim, collapse inner whitespace, lowercase — how a typed city becomes comparable. */
export function normalizeCity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The one definition of "same lane": normalized pickup city + canonical state, then the same for
 * the drop. Priority uniqueness, share totals and Indent matching all compare this key — never
 * ad-hoc lower() calls. Returns null when a state is not a recognised Indian state/UT (so an
 * address with a missing or odd state simply matches no contract).
 */
export function buildLaneKey(lane: LaneParts): string | null {
  const pickupState = resolveIndianState(lane.pickupState);
  const dropState = resolveIndianState(lane.dropState);
  if (!pickupState || !dropState) return null;
  return [
    normalizeCity(lane.pickupCity),
    pickupState,
    normalizeCity(lane.dropCity),
    dropState,
  ].join('|');
}
