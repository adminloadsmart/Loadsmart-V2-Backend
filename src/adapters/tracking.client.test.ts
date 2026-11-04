import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpTrackingClient } from './tracking.client';

vi.mock('../config/env', () => ({
  env: { trackingApiUrl: 'https://tracking.test', jwtSecret: 'secret' },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpTrackingClient.listRunningLateTripIds', () => {
  it('keeps only trips whose fresh ETA is past the promised time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            trips: [
              { tripId: 'late', eta: { projectedDelayMin: 90, stale: false } },
              { tripId: 'on-time', eta: { projectedDelayMin: -30, stale: false } },
              { tripId: 'stale', eta: { projectedDelayMin: 300, stale: true } },
              { tripId: 'no-eta', eta: null },
            ],
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HttpTrackingClient().listRunningLateTripIds('tenant-1')).resolves.toEqual([
      'late',
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://tracking.test/v1/trips?state=active&limit=500',
    );
  });

  it('is null when tracking answers with an error or is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(new HttpTrackingClient().listRunningLateTripIds('tenant-1')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(new HttpTrackingClient().listRunningLateTripIds('tenant-1')).resolves.toBeNull();
  });

  it('is null when tracking is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new HttpTrackingClient('').listRunningLateTripIds('tenant-1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HttpTrackingClient.getTrip', () => {
  it("reads tracking's reverse-geocoded `address` as the position's place name", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              eta: null,
              position: {
                lat: 27.88,
                lng: 76.28,
                recordedAt: '2026-11-02T08:00:00.000Z',
                stale: false,
                address: ' NH 48, Behror, Rajasthan 301701, India ',
              },
            },
          }),
        ),
      ),
    );
    const { position } = await new HttpTrackingClient().getTrip('tenant-1', 'load-1');
    expect(position?.placeName).toBe('NH 48, Behror, Rajasthan 301701, India');
  });
});
