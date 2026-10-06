import { ValidationError } from '../../../shared/errors';

/**
 * Wheel positions for the axle diagram, from the vehicle's wheel count: the steer axle (FL, FR)
 * then one left/right pair per remaining two wheels (R1L, R1R, R2L, R2R, …) — the codes the
 * Record Tyre Maintenance modal shows. With no wheel count on the vehicle, a 6-wheel layout.
 */
export function tyrePositions(wheelCount: number | null): string[] {
  const wheels = wheelCount && wheelCount >= 4 ? wheelCount : 6;
  const positions = ['FL', 'FR'];
  for (let pair = 1; pair <= Math.floor((wheels - 2) / 2); pair += 1) {
    positions.push(`R${pair}L`, `R${pair}R`);
  }
  return positions;
}

/** Every code must be a position on this truck's layout — the same codes Add Truck fits its tyre
 *  set on, so later tyre work lands on (and replaces) those tyres. Codes are expected upper-cased. */
export function assertLayoutPositions(wheelCount: number | null, positions: string[]): void {
  const layout = tyrePositions(wheelCount);
  const unknown = positions.filter((position) => !layout.includes(position));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Not a position on this truck: ${unknown.join(', ')} (expected ${layout.join(', ')})`,
    );
  }
}
