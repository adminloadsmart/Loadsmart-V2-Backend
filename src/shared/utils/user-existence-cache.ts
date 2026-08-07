import { env } from '../../config/env';
import { redisManager } from '../../db/redis';

const CACHE_PREFIX = 'user-exists:';

export async function getCachedUserExists(userId: string): Promise<boolean | null> {
  try {
    const value = await redisManager.get(`${CACHE_PREFIX}${userId}`);
    return value === null ? null : value === '1';
  } catch (err) {
    console.error('Failed to read user-exists cache', err);
    return null;
  }
}

export async function setCachedUserExists(userId: string, exists: boolean): Promise<void> {
  try {
    await redisManager.set(
      `${CACHE_PREFIX}${userId}`,
      exists ? '1' : '0',
      env.userExistsCacheTtlSeconds,
    );
  } catch (err) {
    console.error('Failed to write user-exists cache', err);
  }
}

export async function invalidateUserExistsCache(userId: string): Promise<void> {
  try {
    await redisManager.delete(`${CACHE_PREFIX}${userId}`);
  } catch (err) {
    console.error('Failed to invalidate user-exists cache', err);
  }
}
