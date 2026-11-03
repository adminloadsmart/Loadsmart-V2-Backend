import { describe, expect, it, vi } from 'vitest';
import { VahanIpRateGate, VahanIpRateGateStore } from './vahan-ip-rate-gate';

vi.mock('../../../config/env', () => ({ env: { vahanVerificationRateLimitMs: 120_000 } }));

/** In-memory SET NX PX / PTTL, enough for the gate. */
function fakeStore(now: () => number): VahanIpRateGateStore {
  const expiries = new Map<string, number>();
  return {
    async setIfAbsent(key, _value, pxMs) {
      const expiresAt = expiries.get(key);
      if (expiresAt !== undefined && expiresAt > now()) return false;
      expiries.set(key, now() + pxMs);
      return true;
    },
    async pttl(key) {
      const expiresAt = expiries.get(key);
      return expiresAt === undefined || expiresAt <= now() ? -2 : expiresAt - now();
    },
  };
}

describe('VahanIpRateGate', () => {
  it('gives each IP its own lane of one lookup per window', async () => {
    let clock = 0;
    const gate = new VahanIpRateGate(
      fakeStore(() => clock),
      10_000,
    );

    expect(await gate.tryAcquire('1.1.1.1')).toEqual({ ok: true });
    expect(await gate.tryAcquire('2.2.2.2')).toEqual({ ok: true });

    clock = 4_000;
    expect(await gate.tryAcquire('1.1.1.1')).toEqual({ ok: false, retryInMs: 6_000 });

    clock = 10_000;
    expect(await gate.tryAcquire('1.1.1.1')).toEqual({ ok: true });
  });

  it('retries almost immediately when the slot expired between the two Redis calls', async () => {
    const gate = new VahanIpRateGate(
      { setIfAbsent: async () => false, pttl: async () => -2 },
      10_000,
    );
    expect(await gate.tryAcquire('1.1.1.1')).toEqual({ ok: false, retryInMs: 1000 });
  });
});
