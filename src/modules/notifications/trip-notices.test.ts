import { describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { NotificationRecipient } from './catalog/notification-catalog.types';
import type { TrackingEvent } from './notifications.interface';
import { createTrackingEventHandlers } from './tracking-events.consumer';
import { NotificationTriggers } from './notifications.interface';

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
    markTripStarted: vi.fn(),
    markDetentionDetected: vi.fn(),
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

  it('alert.opened for INACT-SIM queues the SIM-inactive notification at once', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', {
        rule_id: 'INACT-SIM',
        id: 'alert-1',
        trip_id: 'load-1',
        payload: { source: 'sim', lastSeenAt: AT, thresholdMin: 60, reason: 'vendor_error' },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.sim_tracking_inactive', 'tenant-1', {
      loadId: 'load-1',
      alertId: 'alert-1',
      lastSeenAt: AT,
      thresholdMin: 60,
      reason: 'vendor_error',
    });
  });

  it('alert.opened for INACT-SIM without a last-seen time is dropped; other rules still are', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', { rule_id: 'INACT-SIM', id: 'a', trip_id: 'load-1', payload: {} }),
    );
    await handlers['alert.opened']!(
      event('alert.opened', { rule_id: 'DEV-SIM', id: 'a', trip_id: 'load-1', payload: {} }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('SIM-inactive copy: phone case asks to call the driver, vendor case names the provider', () => {
    const base = {
      loadId: 'load-1',
      alertId: 'a1',
      lastSeenAt: AT,
      thresholdMin: 60,
      vehicleNo: 'MH12AB1234',
      loadCode: 'LOAD-1',
      destination: 'Chennai',
      driverName: 'Ramesh',
      driverPhone: '9876500000',
    } as never;
    const entry = NOTIFICATION_CATALOG['load.sim_tracking_inactive'];
    const phone = entry.buildContent({ ...(base as object), reason: 'phone_unreachable' } as never);
    expect(phone.title).toBe('No SIM location from MH12AB1234');
    expect(phone.body).toContain('Call Ramesh');
    const vendor = entry.buildContent({ ...(base as object), reason: 'vendor_error' } as never);
    expect(vendor.body).toContain('provider');
    expect(entry.dedupeKey({ ...(base as object), reason: 'vendor_error' } as never)).toBe(
      'load-1-a1',
    );
  });

  it('alert.opened for DELAY-SIM queues the SIM delay notification', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', {
        rule_id: 'DELAY-SIM',
        id: 'alert-2',
        trip_id: 'load-1',
        severity: 'critical',
        payload: { projectedDelayMin: 250, alreadyLate: false },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.sim_delay', 'tenant-1', {
      loadId: 'load-1',
      alertId: 'alert-2',
      delayMin: 250,
      alreadyLate: false,
      severity: 'critical',
    });
  });

  it('alert.opened for DEV-SIM queues the SIM route-deviation notification', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', {
        rule_id: 'DEV-SIM',
        id: 'alert-3',
        trip_id: 'load-1',
        occurred_at: AT,
        payload: { distanceFromRouteM: 8400, position: { lat: 23.17, lng: 75.78 } },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.sim_route_deviation', 'tenant-1', {
      loadId: 'load-1',
      alertId: 'alert-3',
      deviationStartedAt: AT,
      distanceOffKm: 8.4,
      lat: 23.17,
      lng: 75.78,
    });
  });

  it('alert.opened for NIGHT-SIM queues the SIM night-driving notification', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', {
        rule_id: 'NIGHT-SIM',
        id: 'alert-4',
        trip_id: 'load-1',
        payload: { night: '2026-10-05', startedAt: AT },
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.sim_night_driving', 'tenant-1', {
      loadId: 'load-1',
      alertId: 'alert-4',
      startedAt: AT,
    });
    await handlers['alert.opened']!(
      event('alert.opened', { rule_id: 'NIGHT-SIM', id: 'a', trip_id: null, payload: {} }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1); // a night alert with no trip / start is dropped
    const content = NOTIFICATION_CATALOG['load.sim_night_driving'].buildContent({
      loadId: 'load-1',
      alertId: 'a1',
      startedAt: AT,
      vehicleNo: 'MH12AB1234',
      loadCode: 'LOAD-1',
      destination: 'Chennai',
    } as never);
    expect(content.title).toBe('MH12AB1234 is driving at night');
    expect(content.body).toContain('approximate');
  });

  it('DELAY-SIM / DEV-SIM alerts with missing fields are dropped', async () => {
    const { enqueue, handlers } = setup();
    await handlers['alert.opened']!(
      event('alert.opened', { rule_id: 'DELAY-SIM', id: 'a', trip_id: 'load-1', payload: {} }),
    );
    await handlers['alert.opened']!(
      event('alert.opened', { rule_id: 'DEV-SIM', id: 'a', trip_id: 'load-1', payload: {} }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('SIM delay / deviation copy', () => {
    const base = {
      loadId: 'load-1',
      alertId: 'a1',
      vehicleNo: 'MH12AB1234',
      loadCode: 'LOAD-1',
      destination: 'Chennai',
      driverName: 'Ramesh',
      driverPhone: '9876500000',
    };
    const delay = NOTIFICATION_CATALOG['load.sim_delay'];
    const late = delay.buildContent({
      ...base,
      delayMin: 95,
      alreadyLate: false,
      severity: 'warning',
    } as never);
    expect(late.title).toBe('MH12AB1234 is running 1 h 35 min late');
    expect(late.body).toContain('approximate');
    const already = delay.buildContent({
      ...base,
      delayMin: 30,
      alreadyLate: true,
      severity: 'warning',
    } as never);
    expect(already.title).toBe('MH12AB1234 is already late');
    expect(delay.dedupeKey({ ...base, delayMin: 1, alreadyLate: false } as never)).toBe(
      'load-1-a1',
    );
    const dev = NOTIFICATION_CATALOG['load.sim_route_deviation'].buildContent({
      ...base,
      deviationStartedAt: AT,
      distanceOffKm: 8.4,
      lat: 23.17,
      lng: 75.78,
      location: 'Dewas bypass',
    } as never);
    expect(dev.title).toBe('MH12AB1234 may be off route');
    expect(dev.body).toContain('8 km');
    expect(dev.body).toContain('Dewas bypass');
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
      time_since: '4 hours',
      last_location: 'Dewas bypass',
    });
  });

  it('signal lost: a long silence reads in days, months or years', () => {
    const timeSinceAfter = (hoursSince: number) =>
      NOTIFICATION_CATALOG['load.tracking_signal_lost'].buildContent(
        { ...load, step: 'day_1', lastSeenAt: AT, lastLat: null, lastLng: null, hoursSince },
        recipient,
      ).metadata?.time_since;
    expect(timeSinceAfter(1)).toBe('1 hour');
    expect(timeSinceAfter(23)).toBe('23 hours');
    expect(timeSinceAfter(24)).toBe('1 day');
    expect(timeSinceAfter(29 * 24 + 23)).toBe('29 days');
    expect(timeSinceAfter(45 * 24)).toBe('1 month');
    expect(timeSinceAfter(1428)).toBe('1 month');
    expect(timeSinceAfter(200 * 24)).toBe('6 months');
    expect(timeSinceAfter(800 * 24)).toBe('2 years');
  });

  it('signal lost: {{4}} is a map link without an address, and reads naturally with no GPS', () => {
    const lastLocationOf = (lastLat: number | null, lastLng: number | null) =>
      NOTIFICATION_CATALOG['load.tracking_signal_lost'].buildContent(
        { ...load, step: '4h', lastSeenAt: AT, lastLat, lastLng, hoursSince: 4 },
        recipient,
      ).metadata?.last_location;
    expect(lastLocationOf(22.7, 75.8)).toBe('https://maps.google.com/?q=22.70000,75.80000');
    expect(lastLocationOf(null, null)).toBe('the start of this trip (no GPS received since)');
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
