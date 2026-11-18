import { describe, expect, it } from 'vitest';
import { planStatusUpdate } from './delivery-status';

const at = (second: number) => new Date(Date.UTC(2026, 10, 13, 12, 0, second));
const fresh = {
  status: 'queued' as const,
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  failedAt: null,
};

describe('planStatusUpdate', () => {
  it('records sent', () => {
    expect(planStatusUpdate(fresh, { status: 'sent', timestamp: at(1), error: null })).toEqual({
      status: 'sent',
      sentAt: at(1),
    });
  });

  it('fills delivered and sent when read arrives first (no delivered webhook, L2)', () => {
    expect(planStatusUpdate(fresh, { status: 'read', timestamp: at(2), error: null })).toEqual({
      status: 'read',
      sentAt: at(2),
      deliveredAt: at(2),
      readAt: at(2),
    });
  });

  it('never moves back: a late sent after read changes nothing (L12)', () => {
    const readRow = {
      ...fresh,
      status: 'read' as const,
      sentAt: at(2),
      deliveredAt: at(2),
      readAt: at(2),
    };
    expect(planStatusUpdate(readRow, { status: 'sent', timestamp: at(1), error: null })).toBeNull();
    expect(
      planStatusUpdate(readRow, { status: 'delivered', timestamp: at(3), error: null }),
    ).toBeNull();
  });

  it('records failed with its error, but not after delivery', () => {
    expect(
      planStatusUpdate(
        { ...fresh, status: 'sent', sentAt: at(1) },
        {
          status: 'failed',
          timestamp: at(2),
          error: { code: '131047', title: 'Re-engagement message' },
        },
      ),
    ).toEqual({
      status: 'failed',
      failedAt: at(2),
      error: { code: '131047', title: 'Re-engagement message' },
    });
    const deliveredRow = {
      ...fresh,
      status: 'delivered' as const,
      sentAt: at(1),
      deliveredAt: at(2),
    };
    expect(
      planStatusUpdate(deliveredRow, { status: 'failed', timestamp: at(3), error: null }),
    ).toBeNull();
  });

  it('records deleted once', () => {
    expect(
      planStatusUpdate(
        { ...fresh, status: 'read' },
        { status: 'deleted', timestamp: at(4), error: null },
      ),
    ).toEqual({ status: 'deleted' });
    expect(
      planStatusUpdate(
        { ...fresh, status: 'deleted' },
        { status: 'deleted', timestamp: at(5), error: null },
      ),
    ).toBeNull();
  });
});
