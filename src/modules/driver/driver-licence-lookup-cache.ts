import { redisManager } from '../../db/redis';
import { SarathiDrivingLicenceResult } from '../../adapters/sarathi.client';

const CACHE_PREFIX = 'driver-dl-lookup:';

/**
 * Long enough for an admin to review a bulk-import preview and save it, short enough that a
 * licence suspended in the meantime is not trusted for long.
 */
export const DRIVER_DL_LOOKUP_CACHE_TTL_SECONDS = 60 * 60;

function cacheKey(tenantId: string, licenseNumber: string, dateOfBirth: string): string {
  return `${CACHE_PREFIX}${tenantId}:${licenseNumber}:${dateOfBirth}`;
}

/** Best-effort, like user-existence-cache.ts — a Redis failure just means a fresh lookup. */
export async function getCachedLicenceLookup(
  tenantId: string,
  licenseNumber: string,
  dateOfBirth: string,
): Promise<SarathiDrivingLicenceResult | null> {
  try {
    const value = await redisManager.get(cacheKey(tenantId, licenseNumber, dateOfBirth));
    return value === null ? null : (JSON.parse(value) as SarathiDrivingLicenceResult);
  } catch (err) {
    console.error('Failed to read driver licence lookup cache', err);
    return null;
  }
}

export async function setCachedLicenceLookup(
  tenantId: string,
  licenseNumber: string,
  dateOfBirth: string,
  result: SarathiDrivingLicenceResult,
): Promise<void> {
  try {
    await redisManager.set(
      cacheKey(tenantId, licenseNumber, dateOfBirth),
      JSON.stringify(result),
      DRIVER_DL_LOOKUP_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    console.error('Failed to write driver licence lookup cache', err);
  }
}
