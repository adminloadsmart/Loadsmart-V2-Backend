import { ValidationError } from '../../../shared/errors';

/** Whether the tenant said "Yes, we run our own trucks" at onboarding — AuthService.ownsFleet.
 *  `null` means the question was never answered (legacy orgs), which is treated as allowed. */
export type OwnsFleetLookup = (tenantId: string) => Promise<boolean | null>;

export const OWN_FLEET_NOT_ALLOWED =
  'Your organization uses market trucks only, so loads cannot be sourced from an own fleet';

/** Refuses own-fleet sourcing for an organization that onboarded as "Market trucks only". */
export async function assertOwnFleetAllowed(
  lookup: OwnsFleetLookup | undefined,
  tenantId: string,
): Promise<void> {
  if (!lookup) return;
  if ((await lookup(tenantId)) === false) throw new ValidationError(OWN_FLEET_NOT_ALLOWED);
}
