import { describe, expect, it } from 'vitest';
import { renderDriverMessage, renderStoredDriverMessage } from './driver-notification-content';
import { DRIVER_MESSAGE_PARAMS_KEY } from './notifications.constants';
import { DriverLoadAssignedMessageParams } from './notifications.types';

const oneLoad: DriverLoadAssignedMessageParams = {
  loadCount: 1,
  loadCode: 'LOAD-0552',
  from: 'Jaipur',
  to: 'Delhi',
  pickupAt: '2026-11-03T05:30:00.000Z',
  pickupDate: '2026-11-03',
  vehicleNumber: 'RJ14 AB 1234',
  fleetOwnerName: 'Sharma Logistics',
  fleetOwnerPhone: '9876543210',
};

describe('renderDriverMessage', () => {
  it('renders the invite in English and Hindi', () => {
    const message = {
      type: 'driver.account.invited' as const,
      params: { tenantName: 'Sharma Logistics' },
    };
    expect(renderDriverMessage(message, 'en')).toEqual({
      title: "You've been invited",
      body: 'Sharma Logistics has invited you to join their fleet. Open the app to accept or decline.',
    });
    expect(renderDriverMessage(message, 'hi')).toEqual({
      title: 'आपको आमंत्रण मिला है',
      body: 'Sharma Logistics ने आपको अपने फ्लीट से जुड़ने के लिए आमंत्रित किया है। स्वीकार या अस्वीकार करने के लिए ऐप खोलें।',
    });
  });

  it('keeps the English load-assigned text as it was before translation', () => {
    expect(renderDriverMessage({ type: 'load.assigned', params: oneLoad }, 'en')).toEqual({
      title: 'New load assigned',
      body: 'Load LOAD-0552 has been assigned to you: Jaipur → Delhi · Pickup 3 Nov, 11:00 am · Truck RJ14 AB 1234. Fleet owner: Sharma Logistics (9876543210)',
    });
  });

  it('renders load-assigned in Hindi, with the pickup time in hi-IN', () => {
    const { title, body } = renderDriverMessage({ type: 'load.assigned', params: oneLoad }, 'hi');
    expect(title).toBe('नया लोड असाइन हुआ');
    expect(body).toMatch(
      /^लोड LOAD-0552 आपको असाइन किया गया है: Jaipur → Delhi · पिकअप .+ · ट्रक RJ14 AB 1234। फ्लीट मालिक: Sharma Logistics \(9876543210\)$/,
    );
  });

  it('drops missing load-assigned parts and counts several loads', () => {
    const bare = {
      ...oneLoad,
      from: null,
      pickupAt: null,
      pickupDate: null,
      vehicleNumber: null,
      fleetOwnerPhone: null,
    };
    expect(renderDriverMessage({ type: 'load.assigned', params: bare }, 'en').body).toBe(
      'Load LOAD-0552 has been assigned to you',
    );
    const many = {
      ...bare,
      loadCount: 3,
      loadCode: null,
      fleetOwnerName: null,
      fleetOwnerPhone: '9876543210',
    };
    expect(renderDriverMessage({ type: 'load.assigned', params: many }, 'en').body).toBe(
      '3 loads have been assigned to you. Fleet owner: Fleet owner (9876543210)',
    );
    expect(renderDriverMessage({ type: 'load.assigned', params: many }, 'hi').body).toBe(
      '3 लोड आपको असाइन किए गए हैं। फ्लीट मालिक: फ्लीट मालिक (9876543210)',
    );
  });

  it('renders the POD reminder with and without a vehicle number', () => {
    expect(
      renderDriverMessage(
        { type: 'driver.trip.pod_reminder', params: { loadCode: 'LOAD-1', vehicleNumber: null } },
        'en',
      ).body,
    ).toBe(
      'Load LOAD-1 is at the unloading point. Upload the POD front and back once unloading is done.',
    );
    expect(
      renderDriverMessage(
        { type: 'driver.trip.pod_reminder', params: { loadCode: 'LOAD-1', vehicleNumber: 'RJ14' } },
        'hi',
      ).body,
    ).toBe(
      'लोड LOAD-1 (RJ14) अनलोडिंग पॉइंट पर है। अनलोडिंग पूरी होने के बाद POD के आगे और पीछे की फोटो अपलोड करें।',
    );
  });
});

describe('renderStoredDriverMessage', () => {
  it('re-renders a stored card from its messageParams', () => {
    const metadata = {
      loadIds: ['l1'],
      [DRIVER_MESSAGE_PARAMS_KEY]: { loadCode: 'LOAD-1', pointTitle: 'Gate 2', city: 'Pune' },
    };
    expect(renderStoredDriverMessage('load.loading_point_changed', metadata, 'hi')).toEqual({
      title: 'लोडिंग पॉइंट बदला गया',
      body: 'LOAD-1 का लोडिंग पॉइंट बदलकर Gate 2, Pune कर दिया गया है',
    });
  });

  it('leaves older cards and other types alone', () => {
    expect(renderStoredDriverMessage('load.assigned', { loadIds: ['l1'] }, 'hi')).toBeNull();
    expect(renderStoredDriverMessage('load.assigned', null, 'hi')).toBeNull();
    expect(
      renderStoredDriverMessage('vehicle.compliance_expired', { messageParams: {} }, 'hi'),
    ).toBeNull();
  });
});
