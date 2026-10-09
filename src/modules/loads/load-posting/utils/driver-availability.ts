import { DriverTenantRelationEntity } from '../../../driver/entities/driver-tenant-relation.entity';

export const DRIVER_UNAVAILABLE_REASONS = [
  'not_in_fleet',
  'on_leave',
  'inactive',
  'on_trip',
] as const;
export type DriverUnavailableReason = (typeof DRIVER_UNAVAILABLE_REASONS)[number];

/**
 * Why a driver can't take a load right now, or null when they are idle. "Idle" means an active
 * relationship with this tenant, an operational status of `active` (no status row yet counts as
 * active), and no live load of their own — dispatch never flips a driver to `on_trip`, so the
 * live-load check is what actually catches a busy driver.
 */
export function driverUnavailableReason(
  relation: DriverTenantRelationEntity | undefined,
  onActiveLoad: boolean,
): DriverUnavailableReason | null {
  if (!relation || relation.status !== 'active') return 'not_in_fleet';
  const status = relation.operationalStatus?.operationalStatus ?? 'active';
  if (status === 'on_leave') return 'on_leave';
  if (status === 'inactive') return 'inactive';
  if (status === 'on_trip' || onActiveLoad) return 'on_trip';
  return null;
}
