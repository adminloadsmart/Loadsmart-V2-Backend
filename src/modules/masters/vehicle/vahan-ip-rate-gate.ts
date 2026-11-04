import { env } from '../../../config/env';

const SLOT_KEY_PREFIX = 'ulip:vahan:slot';

/** The two Redis calls the gate needs — `redisManager` satisfies it; tests pass a fake. */
export interface VahanIpRateGateStore {
  setIfAbsent(key: string, value: string, pxMs: number): Promise<boolean>;
  pttl(key: string): Promise<number>;
}

export type VahanSlot = { ok: true } | { ok: false; retryInMs: number };

/**
 * One background VAHAN (ULIP) lookup per window per client IP, across every API instance: each
 * importer's IP is its own lane on the 'vahan-verification' queue, so one large import never holds
 * up another IP's trucks. Same Redis-slot shape as GstRateGate (gst-rate-gate.ts), keyed by IP —
 * a slot expires with the window, so a crashed worker never holds it.
 */
export class VahanIpRateGate {
  constructor(
    private readonly store: VahanIpRateGateStore,
    private readonly windowMs: number = env.vahanVerificationRateLimitMs,
  ) {}

  async tryAcquire(clientIp: string): Promise<VahanSlot> {
    const key = `${SLOT_KEY_PREFIX}:${clientIp}`;
    if (await this.store.setIfAbsent(key, String(Date.now()), this.windowMs)) {
      return { ok: true };
    }
    const ttl = await this.store.pttl(key);
    // Expired between the two calls (or no TTL) — let the caller retry almost immediately.
    return { ok: false, retryInMs: ttl > 0 ? ttl : 1000 };
  }
}
