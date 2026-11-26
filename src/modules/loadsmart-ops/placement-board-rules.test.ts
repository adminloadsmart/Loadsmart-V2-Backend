import { describe, expect, it } from 'vitest';
import {
  brokersClosedReason,
  median,
  memoState,
  placementTabs,
  rateCeiling,
  requirementMessage,
  whatsappLink,
  type PlacementRowFacts,
} from './placement-board-rules';
import { bidWindowClosesAt, manualRateError } from '../loads/bids/bid-rules';

const todayStart = '2026-11-17T18:30:00.000Z'; // 18 Nov IST
const todayEnd = '2026-11-18T18:30:00.000Z';

describe('placement queue tabs', () => {
  const base: PlacementRowFacts = {
    placed: false,
    activeBids: 0,
    ownerId: null,
    reportingAt: null,
    memo: 'not_sent',
  };

  it('splits loads by bids until a truck is placed', () => {
    expect(placementTabs(base, 'me', todayStart, todayEnd)).toEqual(['all', 'without_bids']);
    expect(placementTabs({ ...base, activeBids: 2 }, 'me', todayStart, todayEnd)).toEqual([
      'all',
      'with_bids',
    ]);
    expect(
      placementTabs({ ...base, placed: true, activeBids: 2 }, 'me', todayStart, todayEnd),
    ).toEqual(['all', 'placed']);
  });

  it('adds mine, pickup today and the memo tabs', () => {
    const tabs = placementTabs(
      { ...base, ownerId: 'me', reportingAt: '2026-11-18T03:30:00.000Z', memo: 'sent' },
      'me',
      todayStart,
      todayEnd,
    );
    expect(tabs).toEqual(['all', 'without_bids', 'mine', 'pickup_today', 'memo_sent']);
    expect(placementTabs({ ...base, memo: 'accepted' }, 'me', todayStart, todayEnd)).toContain(
      'memo_confirmed',
    );
    expect(
      placementTabs({ ...base, reportingAt: todayEnd }, 'me', todayStart, todayEnd),
    ).not.toContain('pickup_today');
  });
});

describe('memo state', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  it('reads the latest memo', () => {
    expect(memoState(null, null, now)).toBe('not_sent');
    expect(
      memoState(null, { status: 'sent', expiresAt: new Date('2026-11-18T11:00:00Z') }, now),
    ).toBe('sent');
    expect(
      memoState(null, { status: 'sent', expiresAt: new Date('2026-11-18T09:00:00Z') }, now),
    ).toBe('expired');
    expect(memoState(new Date(), null, now)).toBe('accepted');
  });
});

describe('pricing guidance', () => {
  it('takes the middle carrier rate on the lane', () => {
    expect(median([])).toBeNull();
    expect(median([61_800, 60_900, 64_000])).toBe(61_800);
    expect(median([60_000, 62_000])).toBe(61_000);
  });

  it('caps the carrier rate at the margin floor', () => {
    // ₹1,14,000 to the shipper with a 2% floor leaves at most ₹1,11,720 for the carrier.
    expect(rateCeiling(114_000, 2)).toBe(111_720);
  });
});

describe('requirement to brokers', () => {
  it('names the lane, reporting time and truck but not the shipper or price', () => {
    const message = requirementMessage({
      loadCode: 'LD-260410',
      from: 'Jamshedpur',
      to: 'Pune',
      reportingAt: new Date('2026-11-17T03:30:00Z'),
      truck: 'Multi-axle · 32 ft',
      goods: 'Packaging material',
      tonnes: 14,
    });
    expect(message).toContain('Jamshedpur → Pune');
    expect(message).toContain('Multi-axle · 32 ft');
    expect(message).toContain('Packaging material · 14 MT');
    expect(message).not.toMatch(/₹/);
  });

  it('makes a WhatsApp link for an Indian mobile', () => {
    expect(whatsappLink('98300 72215', 'hi')).toBe('https://wa.me/919830072215?text=hi');
    expect(whatsappLink('123', 'hi')).toBeNull();
  });
});

describe('extended bid window', () => {
  const sentAt = new Date('2026-11-18T04:00:00Z');
  it('adds the extension to the 4-hour window', () => {
    expect(bidWindowClosesAt(sentAt).toISOString()).toBe('2026-11-18T08:00:00.000Z');
    expect(bidWindowClosesAt(sentAt, 120).toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });

  it('keeps phone rates open for the extended window', () => {
    const at = new Date('2026-11-18T09:00:00Z');
    expect(manualRateError(sentAt, at)).not.toBeNull();
    expect(manualRateError(sentAt, at, 120)).toBeNull();
  });
});
