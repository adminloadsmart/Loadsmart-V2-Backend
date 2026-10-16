import { describe, expect, it } from 'vitest';
import {
  bodyTypeOf,
  dailyFixedCost,
  dayBuckets,
  hadExpiredDocumentAt,
  isOnTime,
  jobCategory,
  isServiceOrBreakdown,
  kmInWindow,
  median,
  newTreadMm,
  onLoadInterval,
  perKm,
  periodDays,
  replacementCandidates,
  sizeOf,
  tyreBand,
  tyreLifeLeft,
} from './fleet-analytics.calculations';
import { VehicleEntity } from '../../../masters/vehicle/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../../../masters/vehicle/entities/vehicle-document.entity';
import { MaintenanceJobEntity } from '../../../maintenance/entities/maintenance-job.entity';
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
        { row: 'young-a1', truckTypeKey: 'A', ageYears: 1, perKm: 10 },
        { row: 'young-a2', truckTypeKey: 'A', ageYears: 2, perKm: 20 },
        { row: 'young-b1', truckTypeKey: 'B', ageYears: 1, perKm: 40 },
        { row: 'old-a', truckTypeKey: 'A', ageYears: 6, perKm: 50 },
        { row: 'cheap-old-a', truckTypeKey: 'A', ageYears: 7, perKm: 12 },
        { row: 'old-b', truckTypeKey: 'B', ageYears: 5, perKm: 30 },
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
      replacementCandidates([{ row: 'x', truckTypeKey: 'A', ageYears: 9, perKm: 99 }], 2, 2),
    ).toEqual([]);
  });
});

const istDay = (date: string) => ({
  date,
  from: new Date(`${date}T00:00:00+05:30`),
  to: new Date(`${date}T23:59:59.999+05:30`),
});

const vehicle = (fields: Partial<VehicleEntity>): VehicleEntity =>
  ({
    ownershipType: 'financed',
    hasNationalPermit: null,
    telemetryMeta: null,
    truckType: null,
    axleType: null,
    capacityTons: null,
    bodyLengthFt: null,
    ...fields,
  }) as unknown as VehicleEntity;

const meta = (fields: Record<string, unknown>) =>
  ({
    deletedAt: null,
    emiAmount: null,
    emiEndDate: null,
    leaseRentMonthly: null,
    leaseEndDate: null,
    insurancePremiumYearly: null,
    ...fields,
  }) as unknown as VehicleEntity['telemetryMeta'];

describe('periodDays', () => {
  it('runs from the period start to today when the period is still open', () => {
    const days = periodDays('2026-10-01', '2026-10-31', '2026-10-05');
    expect(days.map((day) => day.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
  });

  it('stops at the period end when that is earlier than today', () => {
    expect(periodDays('2026-09-01', '2026-09-30', '2026-10-16')).toHaveLength(30);
  });
});

describe('dailyFixedCost', () => {
  it('adds EMI ÷ 30, insurance ÷ 365, National Permit ÷ 365 and driver salary ÷ 30', () => {
    const truck = vehicle({
      hasNationalPermit: true,
      telemetryMeta: meta({ emiAmount: '60000', insurancePremiumYearly: '36500' }),
    });
    const cost = dailyFixedCost(truck, 30_000, '2026-10-01');
    expect(cost.emiAndLease).toBe(2_000);
    expect(cost.insurance).toBe(100);
    expect(cost.permit).toBeCloseTo(17_500 / 365);
    expect(cost.driverSalary).toBe(1_000);
    expect(cost.total).toBeCloseTo(2_000 + 100 + 17_500 / 365 + 1_000);
  });

  it('stops the EMI once it has run out and charges no permit without a National Permit', () => {
    const truck = vehicle({
      hasNationalPermit: false,
      telemetryMeta: meta({ emiAmount: '60000', emiEndDate: '2026-09-30' }),
    });
    const cost = dailyFixedCost(truck, 0, '2026-10-01');
    expect(cost.emiAndLease).toBe(0);
    expect(cost.permit).toBe(0);
    expect(cost.total).toBe(0);
  });

  it('charges an attached truck only our driver’s salary', () => {
    const truck = vehicle({
      ownershipType: 'attached',
      hasNationalPermit: true,
      telemetryMeta: meta({ emiAmount: '60000', insurancePremiumYearly: '36500' }),
    });
    expect(dailyFixedCost(truck, 15_000, '2026-10-01')).toEqual({
      emiAndLease: 0,
      insurance: 0,
      permit: 0,
      driverSalary: 500,
      total: 500,
    });
  });
});

describe('dayBuckets', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map(istDay);
  const at = (iso: string) => new Date(iso);

  it('puts every day in exactly one bucket, a load before the workshop', () => {
    const buckets = dayBuckets(
      days,
      [{ from: at('2026-10-01T10:00:00+05:30'), to: at('2026-10-02T08:00:00+05:30') }],
      [{ from: at('2026-10-02T12:00:00+05:30'), to: at('2026-10-03T18:00:00+05:30') }],
    );
    // 1 and 2 Oct on a load (the job on 2 Oct doesn't count), 3 Oct workshop, 4 Oct idle.
    expect(buckets).toEqual({ onLoad: 2, workshop: 1, idle: 1 });
    expect(buckets.onLoad + buckets.workshop + buckets.idle).toBe(days.length);
  });
});

describe('onLoadInterval', () => {
  const now = new Date('2026-10-16T00:00:00Z');
  it('runs from departure to arrival at the unloading point', () => {
    const load = {
      inTransitAt: new Date('2026-10-01T00:00:00Z'),
      reachedDeliveryPointAt: new Date('2026-10-03T00:00:00Z'),
      deliveredAt: new Date('2026-10-03T06:00:00Z'),
    } as LoadEntity;
    expect(onLoadInterval(load, now)).toEqual({
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-03T00:00:00Z'),
    });
  });

  it('runs to now while the load is on the road, and is null before departure', () => {
    const running = { inTransitAt: new Date('2026-10-14T00:00:00Z') } as LoadEntity;
    expect(onLoadInterval(running, now)?.to).toEqual(now);
    expect(onLoadInterval({} as LoadEntity, now)).toBeNull();
  });
});

describe('isOnTime', () => {
  const due = new Date('2026-10-10T18:29:59.999Z');
  it('allows up to 4 hours past the due time', () => {
    expect(isOnTime(new Date(due.getTime() + 4 * 3_600_000), due)).toBe(true);
  });
  it('calls anything after the window closes late', () => {
    expect(isOnTime(new Date(due.getTime() + 4 * 3_600_000 + 60_000), due)).toBe(false);
  });
  it('counts an early arrival as on time', () => {
    expect(isOnTime(new Date(due.getTime() - 86_400_000), due)).toBe(true);
  });
});

describe('maintenance categories', () => {
  const job = (fields: Partial<MaintenanceJobEntity>) => fields as MaintenanceJobEntity;
  it('plans only preventive service; oil changes and tyre jobs are unplanned', () => {
    expect(jobCategory(job({ jobType: 'service', serviceType: 'preventive_service' }))).toBe(
      'preventive',
    );
    expect(jobCategory(job({ jobType: 'service', serviceType: 'oil_change' }))).toBe(
      'unplannedRepair',
    );
    expect(jobCategory(job({ jobType: 'tyre' }))).toBe('unplannedRepair');
    expect(jobCategory(job({ jobType: 'breakdown' }))).toBe('roadsideBreakdown');
  });

  it('leaves tyre jobs out of the preventive share', () => {
    expect(isServiceOrBreakdown(job({ jobType: 'tyre' }))).toBe(false);
    expect(isServiceOrBreakdown(job({ jobType: 'breakdown' }))).toBe(true);
  });
});

describe('tyres', () => {
  it('reads new tread by size, else the recorded tread, and 78% for a retread', () => {
    expect(newTreadMm({ sizeCode: '295/80 R22.5', originalTreadMm: '16', retreadCount: 0 })).toBe(
      14.5,
    );
    expect(newTreadMm({ sizeCode: 'other', originalTreadMm: '16', retreadCount: 0 })).toBe(16);
    expect(
      newTreadMm({ sizeCode: '235/75R17.5', originalTreadMm: '12', retreadCount: 1 }),
    ).toBeCloseTo(12 * 0.78);
  });

  it('bands by life left and by the 4 mm and 2 mm marks', () => {
    const band = (tread: number) => tyreBand(tread, tyreLifeLeft(tread, 14.5));
    expect(band(14)).toBe('new_like'); // ≥ 80% left
    expect(band(9)).toBe('good'); // 57%
    expect(band(5)).toBe('fair'); // above 4 mm, below 50%
    expect(band(4)).toBe('worn');
    expect(band(2)).toBe('very_worn');
  });
});

describe('truck type', () => {
  it('names a container sold by axle after its axle, with tonnage and length as size', () => {
    const truck = vehicle({
      axleType: 'mxl',
      capacityTons: '18.00',
      bodyLengthFt: '32',
    });
    expect(bodyTypeOf(truck).label).toBe('Multi Axle');
    expect(sizeOf(truck)?.label).toBe('18T, 32 ft');
  });
});

describe('hadExpiredDocumentAt', () => {
  const doc = (documentType: string, expiryDate: string, issueDate: string) =>
    ({
      documentType,
      expiryDate,
      issueDate,
      deletedAt: null,
      createdAt: new Date(issueDate),
    }) as VehicleDocumentEntity;
  const now = new Date('2026-10-16T00:00:00Z');

  it('is true inside a lapse and false once the paper is renewed', () => {
    const documents = [
      doc('insurance', '2026-03-31', '2025-04-01'),
      doc('insurance', '2027-04-10', '2026-04-11'),
    ];
    expect(hadExpiredDocumentAt(documents, new Date('2026-04-05T00:00:00Z'), now)).toBe(true);
    expect(hadExpiredDocumentAt(documents, new Date('2026-05-01T00:00:00Z'), now)).toBe(false);
  });

  it('ignores the RC', () => {
    expect(
      hadExpiredDocumentAt(
        [doc('rc', '2026-01-01', '2011-01-01')],
        new Date('2026-05-01T00:00:00Z'),
        now,
      ),
    ).toBe(false);
  });
});

describe('perKm', () => {
  it('divides cost by km and is null without km', () => {
    expect(perKm(1000, 400)).toBe(2.5);
    expect(perKm(1000, 0)).toBeNull();
  });
});
