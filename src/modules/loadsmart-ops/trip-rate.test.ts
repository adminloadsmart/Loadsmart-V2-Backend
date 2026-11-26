import { describe, expect, it } from 'vitest';
import { tripAmount, tripToLoadRate } from './loadsmart-rules';

describe("a broker's rate is the trip total", () => {
  it('is kept per tonne on a per-tonne load, and adds back up to the same trip', () => {
    const rate = tripToLoadRate(8000, 'per_ton', 4);
    expect(rate).toBe(2000);
    expect(tripAmount(rate!, 'per_ton', 4)).toBe(8000);
  });

  it('is kept as is on a per-trip load', () => {
    expect(tripToLoadRate(8000, 'flat', 4)).toBe(8000);
    expect(tripToLoadRate(8000, null, 0)).toBe(8000);
  });

  it('cannot be used on a per-tonne load without a weight', () => {
    expect(tripToLoadRate(8000, 'per_ton', 0)).toBeNull();
  });
});
