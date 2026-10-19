import { describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationRecipient } from './catalog/notification-catalog.types';
import type { NotificationTriggers } from './notification-triggers';
import type { TrackingEvent } from './notifications.interface';
import { createTrackingEventHandlers } from './tracking-events.consumer';

const AT = '2026-10-19T10:15:00.000Z';
const recipient = { fullName: 'Priya Sharma' } as NotificationRecipient;

const event = (type: string, payload: Record<string, unknown>): TrackingEvent => ({
  streamId: '1-0',
  eventId: '9',
  type,
  tenantId: 'tenant-1',
  payload,
});

function setup() {
  const enqueue = vi.fn(async () => undefined);
  const handlers = createTrackingEventHandlers({ enqueue } as unknown as NotificationTriggers, {
    markArrivedAtPickup: vi.fn(),
    markDepartedPickup: vi.fn(),
    markReachedDeliveryPoint: vi.fn(),
    markDepartedDrop: vi.fn(),
    notifyGeofenceTransition: vi.fn(),
  });
  return { enqueue, handlers };
}

describe('tracking trip notices → notifications', () => {
  it('trip.route_deviation queues LS_N_0028', async () => {
    const { enqueue, handlers } = setup();
    await handlers['trip.route_deviation']!(
      event('trip.route_deviation', {
        loadId: 'load-1',
        deviationStartedAt: AT,
        distanceOffKm: 18.4,
        lat: 23.17,
        lng: 75.78,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.route_deviation', 'tenant-1', {
      loadId: 'load-1',
      deviationStartedAt: AT,
      distanceOffKm: 18.4,
      lat: 23.17,
      lng: 75.78,
    });
  });

  it('trip.signal_lost queues LS_N_0029 (position may be unknown)', async () => {
    const { enqueue, handlers } = setup();
    await handlers['trip.signal_lost']!(
      event('trip.signal_lost', { loadId: 'load-1', step: '12h', lastSeenAt: AT, lastLat: null }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.tracking_signal_lost', 'tenant-1', {
      loadId: 'load-1',
      step: '12h',
      lastSeenAt: AT,
      lastLat: null,
      lastLng: null,
    });
  });

  it('trip.delivery_late queues LS_N_0030', async () => {
    const { enqueue, handlers } = setup();
    await handlers['trip.delivery_late']!(
      event('trip.delivery_late', {
        loadId: 'load-1',
        sequence: 2,
        delayMin: 3000,
        etaAt: AT,
        promisedAt: AT,
        delayCause: 'deviation',
        causeMin: 240,
        speedKmh: 30,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.delivery_late', 'tenant-1', {
      loadId: 'load-1',
      sequence: 2,
      delayMin: 3000,
      etaAt: AT,
      promisedAt: AT,
      delayCause: 'deviation',
      causeMin: 240,
      speedKmh: 30,
    });
  });

  it('notices missing their load are skipped', async () => {
    const { enqueue, handlers } = setup();
    await handlers['trip.signal_lost']!(event('trip.signal_lost', { step: '4h', lastSeenAt: AT }));
    await handlers['trip.delivery_late']!(event('trip.delivery_late', { delayMin: 10 }));
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('LS_N_0028 / 0029 / 0030 content', () => {
  const load = { loadId: 'load-1', loadCode: 'LD-4521', vehicleNo: 'HR55QL8450' };

  it('route deviation: sheet copy and Call driver CTA', () => {
    const content = NOTIFICATION_CATALOG['load.route_deviation'].buildContent({
      ...load,
      deviationStartedAt: AT,
      distanceOffKm: 18.4,
      lat: 23.17,
      lng: 75.78,
      location: 'Ujjain bypass',
      deviationDurationMin: 70,
      driverName: 'Ramesh Yadav',
      driverPhone: '9876500000',
    });
    expect(content.title).toBe('HR55QL8450 is off route');
    expect(content.body).toBe(
      '18 km off the planned route near Ujjain bypass for 1 h 10 min. Check with Ramesh Yadav on 9876500000 whether this is a planned diversion.',
    );
    expect(content.metadata).toMatchObject({
      cta_label: 'Call driver',
      cta_phone: '+919876500000',
    });
  });

  it('signal lost: sheet copy and WhatsApp variables', () => {
    const content = NOTIFICATION_CATALOG['load.tracking_signal_lost'].buildContent(
      {
        ...load,
        transporterName: 'Sohal Roadlines',
        step: '4h',
        lastSeenAt: AT,
        lastLat: 22.7,
        lastLng: 75.8,
        lastLocation: 'Dewas bypass',
        hoursSince: 4,
        destination: 'Bhiwandi',
        driverName: 'Ramesh Yadav',
        driverPhone: '9876500000',
      },
      recipient,
    );
    expect(content.title).toBe('No tracking signal from HR55QL8450');
    expect(content.body).toMatch(
      /^Last position Dewas bypass at .+, 4 hours ago, on LD-4521 to Bhiwandi\. Call Ramesh Yadav on 9876500000 or ask Sohal Roadlines to check the device\.$/,
    );
    expect(content.metadata).toMatchObject({
      first_name: 'Priya',
      vehicle_no: 'HR55QL8450',
      hours_since: '4',
      last_location: 'Dewas bypass',
    });
  });

  it('delivery late: personalised copy, reason and SMS/WhatsApp variables', () => {
    const content = NOTIFICATION_CATALOG['load.delivery_late'].buildContent(
      {
        ...load,
        consignee: 'Sundram Buildwell',
        sequence: 1,
        delayMin: 26 * 60,
        etaAt: AT,
        promisedAt: AT,
        delayCause: 'halts',
        causeMin: 9 * 60,
        speedKmh: 28,
        destination: 'Bhiwandi',
      },
      recipient,
    );
    expect(content.title).toBe('LD-4521 will reach Bhiwandi 1 day 2 h late');
    expect(content.body).toMatch(
      /^Priya, HR55QL8450 is now expected at Sundram Buildwell on .+ against a commitment of .+\. Main reason: long halts on the way \(9 h stopped\)\. Tell the consignee or move the delivery slot\.$/,
    );
    expect(content.metadata).toMatchObject({
      first_name: 'Priya',
      load_code: 'LD-4521',
      consignee: 'Sundram Buildwell',
      delay: '1 day 2 h',
      cta_label: 'Notify consignee',
    });
  });
});
