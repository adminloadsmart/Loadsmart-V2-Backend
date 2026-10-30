import { describe, expect, it } from 'vitest';
import { initialTrackingSource } from './tracking-source';

const none = {
  hasGps: false,
  hasDriverApp: false,
  hasDriverNumber: false,
  hasVehicleNumber: false,
};

describe('initialTrackingSource', () => {
  it('prefers GPS over everything', () => {
    expect(
      initialTrackingSource({
        hasGps: true,
        hasDriverApp: true,
        hasDriverNumber: true,
        hasVehicleNumber: true,
      }),
    ).toBe('gps');
  });

  it('uses the driver app when there is no GPS', () => {
    expect(
      initialTrackingSource({
        ...none,
        hasDriverApp: true,
        hasDriverNumber: true,
        hasVehicleNumber: true,
      }),
    ).toBe('driver_app');
  });

  it('uses SIM when there is no GPS or app but a driver number', () => {
    expect(initialTrackingSource({ ...none, hasDriverNumber: true, hasVehicleNumber: true })).toBe(
      'sim',
    );
  });

  it('falls to FASTag without a driver number, and to null without a truck number', () => {
    expect(initialTrackingSource({ ...none, hasVehicleNumber: true })).toBe('fastag');
    expect(initialTrackingSource(none)).toBeNull();
  });
});
