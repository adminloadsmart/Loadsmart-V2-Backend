import { describe, expect, it } from 'vitest';
import { withoutOverviewMoney } from './shipper-analytics.service';
import type { ShipperAnalyticsOverview } from './shipper-analytics.interface';

const metric = (value: number) => ({ value, previous: null, change: null, changeKind: 'relative' });

const overview = {
  meta: { loadsInWindow: 12, unavailable: {}, emptyBecause: null },
  tiles: {
    freightSpend: { ...metric(900000), perTonne: 1200 },
    loadsMoved: { ...metric(12), dispatched: 12 },
    tonnesMoved: { ...metric(300), perLoad: 25 },
    detentionAndClaims: { ...metric(15000), held: 10000, claims: 5000 },
    onTime: { ...metric(91), delivered: 11 },
    freightPerLoad: { ...metric(75000), perTonneKm: null },
  },
  attention: [
    { rule: 'dear_lane', subject: 'Pune', amount: 40000, unit: 'rupees', detail: {}, loadIds: [] },
    {
      rule: 'late_transporter',
      subject: 'Acme',
      amount: 3,
      unit: 'loads',
      detail: {},
      loadIds: [],
    },
  ],
  products: {
    rows: [
      {
        commodityId: 'c-1',
        name: 'Steel',
        tonnes: 300,
        share: 1,
        loads: 12,
        freight: 900000,
        perTonne: 3000,
        tonnesPerLoad: 25,
      },
    ],
    topTwoShare: 1,
  },
  spendByMonth: [{ month: '2026-10' }],
  ratePerTonneKm: [{ month: '2026-10', paid: 4, boardMedian: 5 }],
  transporters: {
    plot: [
      {
        id: 't-1',
        name: 'Acme',
        perTonneKm: 4,
        onTimePct: 90,
        spend: 900000,
        sharePct: 100,
        band: 'high',
      },
    ],
    concentration: { rows: [], topFiveShare: 1, largestShare: 1, carriersTo80: 1 },
  },
  execution: [],
  goDeeper: { freightSpend: 900000, carriersUsed: 1, onTimePct: 91, leakage: 15000 },
} as unknown as ShipperAnalyticsOverview;

describe('withoutOverviewMoney', () => {
  const view = withoutOverviewMoney(overview);

  it('flags the response so the frontend can show "hidden"', () => {
    expect(view.meta.moneyHidden).toBe(true);
  });

  it('drops the rupee tiles and keeps the count/service tiles', () => {
    expect(view.tiles).not.toHaveProperty('freightSpend');
    expect(view.tiles).not.toHaveProperty('freightPerLoad');
    expect(view.tiles).not.toHaveProperty('detentionAndClaims');
    expect(view.tiles.loadsMoved.value).toBe(12);
    expect(view.tiles.onTime.value).toBe(91);
  });

  it('keeps only non-rupee attention findings', () => {
    expect(view.attention.map((finding) => finding.unit)).toEqual(['loads']);
  });

  it('removes spend from products, series, transporter plot, concentration and goDeeper', () => {
    expect(view.products.rows[0]).not.toHaveProperty('freight');
    expect(view.products.rows[0]).not.toHaveProperty('perTonne');
    expect(view.products.rows[0].tonnes).toBe(300);
    expect(view.spendByMonth).toEqual([]);
    expect(view.ratePerTonneKm).toEqual([]);
    expect(view.transporters.plot[0]).not.toHaveProperty('spend');
    expect(view.transporters.plot[0]).not.toHaveProperty('perTonneKm');
    expect(view.transporters.plot[0].onTimePct).toBe(90);
    expect(view.transporters).not.toHaveProperty('concentration');
    expect(view.goDeeper).not.toHaveProperty('freightSpend');
    expect(view.goDeeper).not.toHaveProperty('leakage');
    expect(view.goDeeper.carriersUsed).toBe(1);
  });
});
