import { randomUUID } from 'node:crypto';
import type { RedisManager } from '../../../db/redis';
import { INBOUND_SENDER_LOCK_PREFIX, INBOUND_SENDER_LOCK_TTL_MS } from '../messaging.constants';
import { SenderLock } from './inbound-pipeline.service';

/** One worker per sender at a time (SET NX PX). The TTL frees a lock left by a crashed worker. */
export class RedisSenderLock implements SenderLock {
  constructor(private readonly redis: RedisManager) {}

  async acquire(senderPhone: string): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.redis.setIfAbsent(
      this.lockKey(senderPhone),
      token,
      INBOUND_SENDER_LOCK_TTL_MS,
    );
    return acquired ? token : null;
  }

  async release(senderPhone: string, token: string): Promise<void> {
    const lockKey = this.lockKey(senderPhone);
    // Only the holder releases; an expired-and-retaken lock belongs to someone else.
    if ((await this.redis.get(lockKey)) === token) {
      await this.redis.delete(lockKey);
    }
  }

  private lockKey(senderPhone: string): string {
    return `${INBOUND_SENDER_LOCK_PREFIX}${senderPhone}`;
  }
}
