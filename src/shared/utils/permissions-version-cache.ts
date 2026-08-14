import { env } from '../../config/env';
import { redisManager } from '../../db/redis';

const CACHE_PREFIX = 'permissions-version:';

export async function getCachedPermissionsVersion(userId: string): Promise<number | null> {
  try {
    const value = await redisManager.get(`${CACHE_PREFIX}${userId}`);
    return value === null ? null : Number(value);
  } catch (err) {
    console.error('Failed to read permissions-version cache', err);
    return null;
  }
}

// Called both on a cache-miss refill and, actively, right after role.service.ts bumps a user's
// permissions_version — so a permission change is reflected without waiting for the TTL to lapse.
export async function setCachedPermissionsVersion(userId: string, version: number): Promise<void> {
  try {
    await redisManager.set(
      `${CACHE_PREFIX}${userId}`,
      String(version),
      env.permissionsVersionCacheTtlSeconds,
    );
  } catch (err) {
    console.error('Failed to write permissions-version cache', err);
  }
}
