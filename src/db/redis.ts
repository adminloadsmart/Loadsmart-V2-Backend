import Redis from 'ioredis';
import { env } from '../config/env';

class RedisManager {
  private client: Redis | null = null;

  async connect(): Promise<void> {
    this.client = new Redis(env.redisUrl);
    await this.client.ping();
  }

  async close(): Promise<void> {
    await this.getClient().quit();
    this.client = null;
  }

  async set(key: string, value: string | number, exSeconds?: number): Promise<'OK'> {
    return exSeconds !== undefined
      ? this.getClient().set(key, value, 'EX', exSeconds)
      : this.getClient().set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async delete(key: string): Promise<number> {
    return this.getClient().del(key);
  }

  async smembers(key: string): Promise<string[]> {
    return this.getClient().smembers(key);
  }

  // Atomic increment used for counters (rate limiting, OTP attempt caps). expire() runs on every
  // call, not just the first, so this is a renewing window rather than a strict fixed one —
  // acceptable for defensive rate limiting, not intended for precise billing-grade counting.
  async incr(key: string, exSeconds: number): Promise<number> {
    const results = await this.getClient().multi().incr(key).expire(key, exSeconds).exec();
    const [err, count] = results?.[0] ?? [];
    if (err) throw err;
    return count as number;
  }

  private getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }
    return this.client;
  }
}

export const redisManager = new RedisManager();
