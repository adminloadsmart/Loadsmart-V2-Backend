import { DriverTenantRelationEntity } from '../../../driver/entities/driver-tenant-relation.entity';

export const DRIVER_UNAVAILABLE_REASONS = [
  'not_in_fleet',
  'on_leave',
  'medically_unfit',
  'inactive',
  'on_trip',
  'app_not_installed',
] as const;
export type DriverUnavailableReason = (typeof DRIVER_UNAVAILABLE_REASONS)[number];

/**
 * Why a driver can't take a load right now, or null when they are idle. "Idle" means an active
 * relationship with this tenant, an operational status of `active` (no status row yet counts as
 * active), no live load of their own — dispatch never flips a driver to `on_trip`, so the
 * live-load check is what actually catches a busy driver — and the driver app installed (logged
 * in at least once), since an own-fleet trip is delivered through the app.
 */
export function driverUnavailableReason(
  relation: DriverTenantRelationEntity | undefined,
  onActiveLoad: boolean,
  hasApp: boolean,
): DriverUnavailableReason | null {
  if (!relation || relation.status !== 'active') return 'not_in_fleet';
  const status = relation.operationalStatus?.operationalStatus ?? 'active';
  if (status === 'on_leave') return 'on_leave';
  if (status === 'medically_unfit') return 'medically_unfit';
  if (status === 'inactive') return 'inactive';
  if (status === 'on_trip' || onActiveLoad) return 'on_trip';
  if (!hasApp) return 'app_not_installed';
  return null;
}
