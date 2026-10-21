import { env } from '../../../config/env';

const SLOT_KEY = 'idfy:gst:slot';

/** The two Redis calls the gate needs — `redisManager` satisfies it; tests pass a fake. */
export interface GstRateGateStore {
  setIfAbsent(key: string, value: string, pxMs: number): Promise<boolean>;
  pttl(key: string): Promise<number>;
}

export type GstSlot = { ok: true } | { ok: false; retryInMs: number };

/**
 * One IDfy GST lookup per window, across every API instance and both callers: the Settings →
 * Masters Verify button (GstVerificationService.verify) and the bulk-import 'gst-verification'
 * worker. A slot is a Redis key that expires with the window, so a crashed caller never holds it.
 */
export class GstRateGate {
  constructor(
    private readonly store: GstRateGateStore,
    private readonly windowMs: number = env.gstVerificationRateLimitMs,
  ) {}

  async tryAcquire(): Promise<GstSlot> {
    if (await this.store.setIfAbsent(SLOT_KEY, String(Date.now()), this.windowMs)) {
      return { ok: true };
    }
    const ttl = await this.store.pttl(SLOT_KEY);
    // Expired between the two calls (or no TTL) — let the caller retry almost immediately.
    return { ok: false, retryInMs: ttl > 0 ? ttl : 1000 };
  }
}
