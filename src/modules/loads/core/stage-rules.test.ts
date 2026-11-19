import { describe, expect, it } from 'vitest';
import { decideStage } from './stage-rules';

const loadsmartLoad = (over: Record<string, unknown> = {}) =>
  ({
    status: 'reached_loading',
    route: 'loadsmart',
    awardedParty: 'loadsmart',
    invoiceNumber: 'INV-1',
    invoiceFileKey: 'loads/invoice/a.png',
    ewayBillNumber: 'EWB-1',
    ewayBillFileKey: 'loads/eway-bill/a.png',
    elrFileKey: null,
    lsPapersApprovedAt: null,
    ...over,
  }) as never;

describe('releasing a Loadsmart load at the loading point', () => {
  it('lets the shipper mark it loaded with just their invoice and e-way bill', () => {
    expect(decideStage(loadsmartLoad(), 'papers_complete', 'shipper').ok).toBe(true);
  });

  it('still needs the e-way bill', () => {
    const decision = decideStage(
      loadsmartLoad({ ewayBillFileKey: null }),
      'papers_complete',
      'shipper',
    );
    expect(decision.ok).toBe(false);
  });

  it('never lets a driver do it', () => {
    expect(decideStage(loadsmartLoad(), 'papers_complete', 'driver').ok).toBe(false);
  });

  it('leaves Loadsmart’s own route (papers approved by Tracking) as it was', () => {
    expect(decideStage(loadsmartLoad(), 'papers_complete', 'ls_team').ok).toBe(false);
    expect(
      decideStage(
        loadsmartLoad({ elrFileKey: 'trips/lr/a.png', lsPapersApprovedAt: new Date() }),
        'papers_complete',
        'ls_team',
      ).ok,
    ).toBe(true);
  });

  it('releases a loaded truck for the drop', () => {
    expect(decideStage(loadsmartLoad({ status: 'loaded' }), 'left_loading', 'shipper').ok).toBe(
      true,
    );
  });
});

describe('the POD on a Loadsmart load', () => {
  const atUnloading = (over: Record<string, unknown> = {}) =>
    loadsmartLoad({
      status: 'reached_unloading',
      podFileKey: 'trips/pod/a.png',
      podStatus: 'accepted',
      shortageOrDamage: 'none',
      ...over,
    });

  it('moves to Delivered when the shipper recorded the POD themselves', () => {
    expect(decideStage(atUnloading(), 'pod_clean', 'shipper').ok).toBe(true);
  });

  it('still lets Loadsmart’s Tracking team decide a driver’s POD', () => {
    expect(decideStage(atUnloading(), 'pod_clean', 'ls_team').ok).toBe(true);
  });

  it('goes to Delivered with issues when something was noted', () => {
    expect(
      decideStage(atUnloading({ shortageOrDamage: 'shortage' }), 'pod_issue', 'shipper').ok,
    ).toBe(true);
  });
});
