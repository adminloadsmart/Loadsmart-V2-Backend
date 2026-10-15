import { describe, expect, it } from 'vitest';
import {
  blockedDaysInWindow,
  isOnTime,
  kmInWindow,
  lateDays,
  loadInterval,
  median,
  perKm,
  replacementCandidates,
  unionDaysInWindow,
} from './fleet-analytics.calculations';
import { VehicleDocumentEntity } from '../../../masters/vehicle/entities/vehicle-document.entity';
import { LoadEntity } from '../../../loads/entities/load.entity';

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

describe('unionDaysInWindow', () => {
  it('counts overlapping loads once and clips to the window', () => {
    const days = unionDaysInWindow(
      [
        { from: d('2026-02-25'), to: d('2026-03-05') }, // 4 days inside
        { from: d('2026-03-03'), to: d('2026-03-08') }, // overlaps: +3 days
        { from: d('2026-04-01'), to: d('2026-04-03') }, // separate: +2 days
      ],
      window,
    );
    expect(days).toBeCloseTo(9);
  });

  it('reads nothing outside the window', () => {
    expect(unionDaysInWindow([{ from: d('2026-01-01'), to: d('2026-02-01') }], window)).toBe(0);
  });
});

describe('blockedDaysInWindow', () => {
  const doc = (
    documentType: string,
    expiryDate: string,
    issueDate: string | null,
  ): VehicleDocumentEntity =>
    ({
      documentType,
      expiryDate,
      issueDate,
      deletedAt: null,
      createdAt: d(issueDate ?? '2025-01-01'),
    }) as VehicleDocumentEntity;
  const now = d('2026-09-01');

  it('counts a lapse that was renewed inside the window', () => {
    // Insurance out from 1 Apr (day after 31 Mar) until the new copy starts on 11 Apr.
    const days = blockedDaysInWindow(
      [doc('insurance', '2026-03-31', '2025-04-01'), doc('insurance', '2027-04-10', '2026-04-11')],
      window,
      now,
    );
    expect(days).toBeGreaterThan(9.5);
    expect(days).toBeLessThan(10.5);
  });

  it('counts nothing when the paper was renewed before it ran out', () => {
    const days = blockedDaysInWindow(
      [doc('insurance', '2026-03-31', '2025-04-01'), doc('insurance', '2027-03-31', '2026-03-20')],
      window,
      now,
    );
    expect(days).toBe(0);
  });

  it('runs to now when the paper was never renewed', () => {
    const days = blockedDaysInWindow([doc('insurance', '2026-08-21', '2025-08-22')], window, now);
    expect(days).toBeGreaterThan(9.5);
    expect(days).toBeLessThan(10.5);
  });
});

describe('isOnTime', () => {
  const promised = new Date('2026-03-10T18:29:59.999Z');
  it('allows exactly half an hour late', () => {
    expect(isOnTime(new Date(promised.getTime() + 30 * 60 * 1000), promised)).toBe(true);
  });
  it('calls anything beyond half an hour late', () => {
    expect(isOnTime(new Date(promised.getTime() + 31 * 60 * 1000), promised)).toBe(false);
  });
  it('measures lateness in days, 0 when early', () => {
    expect(lateDays(new Date(promised.getTime() - 1000), promised)).toBe(0);
    expect(lateDays(new Date(promised.getTime() + 2 * 86_400_000), promised)).toBeCloseTo(2);
  });
});

describe('loadInterval', () => {
  const now = d('2026-05-01');
  it('runs from the plant to delivery', () => {
    const load = { atPlantAt: d('2026-03-01'), deliveredAt: d('2026-03-04') } as LoadEntity;
    expect(loadInterval(load, now)).toEqual({ from: d('2026-03-01'), to: d('2026-03-04') });
  });
  it('runs to now while the load is on the road', () => {
    const load = {
      atPlantAt: null,
      loadingConfirmedAt: d('2026-04-20'),
      deliveredAt: null,
    } as LoadEntity;
    expect(loadInterval(load, now)).toEqual({ from: d('2026-04-20'), to: now });
  });
  it('is null before the truck reaches the plant', () => {
    expect(loadInterval({} as LoadEntity, now)).toBeNull();
  });
});

describe('perKm', () => {
  it('divides cost by km and is null without km', () => {
    expect(perKm(1000, 400)).toBe(2.5);
    expect(perKm(1000, 0)).toBeNull();
  });
});
