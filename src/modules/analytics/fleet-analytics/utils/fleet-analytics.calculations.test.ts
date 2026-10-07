import { describe, expect, it } from 'vitest';
import { kmInWindow, median, replacementCandidates } from './fleet-analytics.calculations';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const window = { from: d('2026-03-01'), to: d('2026-09-01') };

describe('kmInWindow', () => {
  it('reads exact edges as actual readings', () => {
    expect(
      kmInWindow(
        [
          { at: d('2026-03-01'), km: 10_000 },
          { at: d('2026-09-01'), km: 40_000 },
        ],
        window,
      ),
    ).toEqual({ km: 30_000, estimated: false });
  });

  it('interpolates between readings either side of an edge', () => {
    const result = kmInWindow(
      [
        { at: d('2026-01-01'), km: 0 },
        { at: d('2026-05-01'), km: 12_000 },
        { at: d('2026-09-01'), km: 30_000 },
      ],
      window,
    );
    // 1 Mar is 59 of the 120 days between 1 Jan and 1 May → 5,900 km.
    expect(result).toEqual({ km: 24_100, estimated: true });
  });

  it('clamps before the first reading and extrapolates past the last', () => {
    const result = kmInWindow(
      [
        { at: d('2026-05-01'), km: 1_000 },
        { at: d('2026-07-01'), km: 7_100 },
      ],
      window,
    );
    // 6,100 km over 61 days = 100 km/day, run on for the 62 days to 1 Sep.
    expect(result).toEqual({ km: 12_300, estimated: true });
  });

  it('drops a reading lower than an earlier one', () => {
    expect(
      kmInWindow(
        [
          { at: d('2026-03-01'), km: 10_000 },
          { at: d('2026-06-01'), km: 1_000 },
          { at: d('2026-09-01'), km: 20_000 },
        ],
        window,
      ),
    ).toEqual({ km: 10_000, estimated: false });
  });

  it('reads nothing from fewer than two readings', () => {
    expect(kmInWindow([{ at: d('2026-04-01'), km: 5_000 }], window)).toEqual({
      km: 0,
      estimated: true,
    });
  });
});

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('replacementCandidates', () => {
  it('benchmarks against young trucks of the class, else the fleet', () => {
    const result = replacementCandidates(
      [
        { row: 'young-a1', truckTypeId: 'A', ageYears: 1, perKm: 10 },
        { row: 'young-a2', truckTypeId: 'A', ageYears: 2, perKm: 20 },
        { row: 'young-b1', truckTypeId: 'B', ageYears: 1, perKm: 40 },
        { row: 'old-a', truckTypeId: 'A', ageYears: 6, perKm: 50 },
        { row: 'cheap-old-a', truckTypeId: 'A', ageYears: 7, perKm: 12 },
        { row: 'old-b', truckTypeId: 'B', ageYears: 5, perKm: 30 },
      ],
      2,
      2,
    );
    expect(result).toEqual([
      { row: 'old-a', perKm: 50, benchmarkPerKm: 15, benchmarkScope: 'class', extraPerKm: 35 },
      // Class B has one young truck, so it falls back to the fleet's young median (20).
      { row: 'old-b', perKm: 30, benchmarkPerKm: 20, benchmarkScope: 'fleet', extraPerKm: 10 },
    ]);
  });

  it('returns nothing without any young truck to benchmark against', () => {
    expect(
      replacementCandidates([{ row: 'x', truckTypeId: 'A', ageYears: 9, perKm: 99 }], 2, 2),
    ).toEqual([]);
  });
});
