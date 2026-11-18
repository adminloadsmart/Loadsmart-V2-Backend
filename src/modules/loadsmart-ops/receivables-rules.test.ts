import { describe, expect, it } from 'vitest';
import { expectedAdvance, receivableStatus, type ReceivableStatusInput } from './receivables-rules';

describe('expected shipper advance', () => {
  it('is the percent of freight plus approved loading charges', () => {
    // The design's LD-260409: 50% of (₹92,000 + ₹1,600).
    expect(expectedAdvance(50, 92_000, 1_600)).toBe(46_800);
  });

  it('is nothing when no advance is agreed', () => {
    expect(expectedAdvance(0, 92_000, 1_600)).toBe(0);
  });
});

describe('receivables board status', () => {
  const base: ReceivableStatusInput = {
    loadStatus: 'loaded',
    podIn: false,
    invoiceStatus: null,
    needsOriginalPod: false,
    originalPodAtLoadsmart: false,
    payerPodStatus: 'not_sent',
    advanceExpected: 46_800,
    advanceReceived: 0,
  };

  it('is advance due until the advance is in, then advance paid', () => {
    expect(receivableStatus(base)).toBe('advance_due');
    expect(receivableStatus({ ...base, advanceReceived: 20_000 })).toBe('advance_due');
    expect(receivableStatus({ ...base, advanceReceived: 46_800 })).toBe('advance_paid');
  });

  it('is advance paid when no advance is agreed', () => {
    expect(receivableStatus({ ...base, advanceExpected: 0 })).toBe('advance_paid');
  });

  it('moves to POD image in once the POD is uploaded', () => {
    expect(receivableStatus({ ...base, loadStatus: 'delivered_ok', podIn: true })).toBe(
      'pod_image_in',
    );
  });

  it('waits for the original when the shipper is billed on it', () => {
    const delivered = { ...base, loadStatus: 'delivered_ok' as const, podIn: true };
    expect(receivableStatus({ ...delivered, needsOriginalPod: true })).toBe(
      'awaiting_original_pod',
    );
    expect(
      receivableStatus({ ...delivered, needsOriginalPod: true, originalPodAtLoadsmart: true }),
    ).toBe('pod_image_in');
  });

  it('follows the original to the payer once invoiced', () => {
    const invoiced = {
      ...base,
      loadStatus: 'invoice_generated' as const,
      podIn: true,
      invoiceStatus: 'issued' as const,
      needsOriginalPod: true,
      originalPodAtLoadsmart: true,
    };
    expect(receivableStatus(invoiced)).toBe('invoice_generated');
    expect(receivableStatus({ ...invoiced, payerPodStatus: 'in_transit' })).toBe('pod_in_transit');
    expect(receivableStatus({ ...invoiced, payerPodStatus: 'received' })).toBe(
      'pod_received_by_payer',
    );
  });

  it('is closed when paid, short/excess when the money does not match', () => {
    const invoiced = { ...base, loadStatus: 'payment' as const, podIn: true };
    expect(receivableStatus({ ...invoiced, invoiceStatus: 'paid' })).toBe('invoice_paid_closed');
    expect(receivableStatus({ ...invoiced, invoiceStatus: 'short_paid' })).toBe('short_excess');
    expect(receivableStatus({ ...invoiced, invoiceStatus: 'excess' })).toBe('short_excess');
    expect(receivableStatus({ ...invoiced, invoiceStatus: 'partly_paid' })).toBe('short_excess');
  });
});
