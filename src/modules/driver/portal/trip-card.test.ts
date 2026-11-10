import { describe, expect, it } from 'vitest';
import type { NotificationEntity } from '../../notifications/notifications.entity';
import { TripCardLoad } from './driver-portal.types';
import { tripCardRefOf, tripCardStateOf } from './trip-card';

const assignedLoad: TripCardLoad = {
  id: 'load-1',
  tenantId: 'tenant-1',
  driverId: 'driver-1',
  status: 'truck_assigned',
  loadingContactName: 'Ravi',
  loadingContactPhone: '9876543210',
  loadingPointId: 'point-1',
  loadingPoint: { title: 'Plant A' },
};

function card(type: string, metadata: Record<string, unknown> = {}) {
  return {
    type,
    tenantId: 'tenant-1',
    metadata: { loadIds: ['load-1'], ...metadata },
  } as unknown as NotificationEntity;
}

function stateOf(notification: NotificationEntity, ...loads: Partial<TripCardLoad>[]) {
  const ref = tripCardRefOf(notification)!;
  const byId = new Map(
    loads.map((load) => {
      const full = { ...assignedLoad, ...load };
      return [full.id, full] as const;
    }),
  );
  return tripCardStateOf(notification, ref, byId, 'driver-1');
}

describe('driver app — load card flag (`trip`)', () => {
  describe('New load assigned', () => {
    const assigned = card('load.assigned');

    it('is actionable from assignment until the truck unloads', () => {
      expect(stateOf(assigned, {})).toEqual({
        loadIds: ['load-1'],
        status: 'active',
        actionable: true,
      });
      expect(stateOf(assigned, { status: 'reached_unloading' })?.actionable).toBe(true);
      expect(stateOf(assigned, { status: 'delivered_ok' })).toMatchObject({
        status: 'completed',
        actionable: false,
      });
      expect(stateOf(assigned, { status: 'closed' })?.status).toBe('completed');
    });

    it('turns off once the load is another driver’s, unassigned or gone', () => {
      expect(stateOf(assigned, { driverId: 'driver-2' })?.status).toBe('reassigned');
      expect(stateOf(assigned, { status: 'created', driverId: 'driver-1' })?.status).toBe(
        'reassigned',
      );
      expect(stateOf(assigned)).toMatchObject({ status: 'unavailable', actionable: false });
    });

    it('stays actionable on a several-loads card while any load is live', () => {
      const several = card('load.assigned', { loadIds: ['load-1', 'load-2'] });
      expect(
        stateOf(several, { status: 'delivered_ok' }, { id: 'load-2', status: 'loaded' }),
      ).toEqual({ loadIds: ['load-1', 'load-2'], status: 'active', actionable: true });
      expect(
        stateOf(several, { status: 'delivered_ok' }, { id: 'load-2', driverId: 'driver-2' }),
      ).toMatchObject({ status: 'completed', actionable: false });
    });

    it('never matches a load from another tenant', () => {
      expect(stateOf(assigned, { tenantId: 'tenant-2' })?.status).toBe('unavailable');
    });
  });

  describe('Loading contact changed', () => {
    const contact = card('load.loading_contact_changed', {
      messageParams: { loadCode: 'LOAD-1', name: 'Ravi', phoneNumber: '9876543210' },
    });

    it('is actionable while it is the current contact and loading is not done', () => {
      expect(stateOf(contact, { status: 'reached_loading' })?.actionable).toBe(true);
    });

    it('reads replaced once the contact changes again', () => {
      expect(stateOf(contact, { loadingContactPhone: '9000000000' })).toMatchObject({
        status: 'replaced',
        actionable: false,
      });
      expect(stateOf(contact, { loadingContactName: 'Suresh' })?.status).toBe('replaced');
    });

    it('reads completed once loading is done', () => {
      expect(stateOf(contact, { status: 'loaded' })?.status).toBe('completed');
    });
  });

  describe('Loading point changed', () => {
    it('matches on the saved point id', () => {
      const point = card('load.loading_point_changed', {
        loadingPointId: 'point-1',
        messageParams: { loadCode: 'LOAD-1', pointTitle: 'Plant A', city: 'Pune' },
      });
      expect(stateOf(point, {})?.status).toBe('active');
      expect(stateOf(point, { loadingPointId: 'point-2' })?.status).toBe('replaced');
      expect(stateOf(point, { status: 'in_transit_unloading' })?.status).toBe('completed');
    });

    it('matches an older card (no saved id) on the point’s title', () => {
      const older = card('load.loading_point_changed', {
        messageParams: { loadCode: 'LOAD-1', pointTitle: 'Plant A', city: 'Pune' },
      });
      expect(stateOf(older, {})?.status).toBe('active');
      expect(stateOf(older, { loadingPoint: { title: 'Plant B' } })?.status).toBe('replaced');
    });
  });

  it('leaves every other notification alone', () => {
    expect(tripCardRefOf(card('driver.trip.pod_reminder'))).toBeNull();
    expect(tripCardRefOf(card('load.assigned', { loadIds: undefined }))).toBeNull();
  });
});
