import { describe, expect, it } from 'vitest';
import { loadsmartBidEvents, type LoadsmartBidFacts } from './bid-history-rules';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 10, minute));

function bid(overrides: Partial<LoadsmartBidFacts>): LoadsmartBidFacts {
  return {
    id: 'bid-1',
    lsPartnerBidId: 'pb-1',
    status: 'received',
    rateHistory: [{ at: at(0).toISOString(), by: 'u', kind: 'bid', rate: '1680' }],
    createdAt: at(0),
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

const kinds = (events: ReturnType<typeof loadsmartBidEvents>) =>
  events.sort((a, b) => a.at.getTime() - b.at.getTime()).map((event) => event.event);

describe("a broker's history shows Loadsmart's side", () => {
  it('sent, countered and the answer, from the bid rate history', () => {
    const events = loadsmartBidEvents(
      [
        bid({
          rateHistory: [
            { at: at(0).toISOString(), by: 'u', kind: 'bid', rate: '1680' },
            { at: at(5).toISOString(), by: 's', kind: 'counter', rate: '1560' },
            { at: at(9).toISOString(), by: 'u', kind: 'counter_accepted', rate: '1560' },
          ],
        }),
      ],
      null,
    );
    expect(kinds(events)).toEqual(['sent_to_shipper', 'shipper_countered', 'counter_accepted']);
    expect(events.find((e) => e.event === 'shipper_countered')?.rate).toBe('1560');
  });

  it('a bid the shipper rejected, with their reason', () => {
    const events = loadsmartBidEvents(
      [bid({ status: 'rejected', decidedAt: at(7), rejectionReason: 'Too high' })],
      null,
    );
    expect(events.at(-1)).toMatchObject({ event: 'shipper_rejected', note: 'Too high' });
  });

  it('a bid replaced by a new price to the shipper is not a rejection', () => {
    const events = loadsmartBidEvents(
      [
        bid({ status: 'rejected', decidedAt: at(6) }),
        bid({ id: 'bid-2', createdAt: at(6), rateHistory: [] }),
      ],
      null,
    );
    expect(events.map((e) => e.event)).toContain('replaced');
    expect(events.map((e) => e.event)).not.toContain('shipper_rejected');
  });

  it('won, or lost when the shipper awarded another bid', () => {
    expect(
      loadsmartBidEvents([bid({ status: 'accepted', decidedAt: at(8) })], 'bid-1').at(-1)?.event,
    ).toBe('won');
    expect(
      loadsmartBidEvents([bid({ status: 'rejected', decidedAt: at(8) })], 'other').at(-1)?.event,
    ).toBe('lost');
  });
});
