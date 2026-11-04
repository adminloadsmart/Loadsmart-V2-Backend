import type { FleetOwnerDetails } from '../../auth/auth.service';
import { LoadEntity } from '../entities/load.entity';
import { resolveLoadOrigin } from './load-origin';
import { DRIVER_MESSAGE_PARAMS_KEY } from '../../notifications/notifications.constants';
import type { DriverMessage } from '../../notifications/notifications.types';

/** Looks up the fleet owner behind a tenant — AuthService.getFleetOwner. */
export type FleetOwnerLookup = (tenantId: string) => Promise<FleetOwnerDetails>;

const formatPickup = (load: LoadEntity): string | null => {
  const at = load.posting?.pickupAt;
  if (at) {
    return at.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return resolveLoadOrigin(load).pickupDate;
};

/**
 * The driver's "New load assigned" push: the load, route, pickup and truck, then who to call —
 * as values (`message`), rendered per device language by driver-notification-content.ts.
 * `metadata` keeps its display fields for the app, plus those values under messageParams.
 * `loads` needs the origin relations loaded (LoadRepository.findDetailById). With more than one
 * load the body is a count — each one is in the app.
 */
export function driverAssignmentMessage(loads: LoadEntity[], owner: FleetOwnerDetails | null) {
  const contact = owner?.owner ?? owner?.dispatch ?? null;
  const fleetOwner = owner
    ? {
        organizationName: owner.organizationName,
        name: contact?.name ?? null,
        phoneNumber: contact?.phoneNumber ?? null,
      }
    : null;
  const fleetOwnerParams = {
    fleetOwnerName: contact ? (contact.name ?? owner?.organizationName ?? null) : null,
    fleetOwnerPhone: contact?.phoneNumber ?? null,
  };

  if (loads.length !== 1) {
    const message: DriverMessage = {
      type: 'load.assigned',
      params: {
        loadCount: loads.length,
        loadCode: null,
        from: null,
        to: null,
        pickupAt: null,
        pickupDate: null,
        vehicleNumber: null,
        ...fleetOwnerParams,
      },
    };
    return {
      message,
      metadata: {
        loadIds: loads.map((load) => load.id),
        fleetOwner,
        [DRIVER_MESSAGE_PARAMS_KEY]: message.params,
      },
    };
  }

  const [load] = loads;
  const { pickup, drop } = resolveLoadOrigin(load);
  const from = pickup?.city ?? pickup?.title ?? null;
  const to = drop?.city ?? drop?.location ?? null;
  const message: DriverMessage = {
    type: 'load.assigned',
    params: {
      loadCount: 1,
      loadCode: load.code,
      from,
      to,
      pickupAt: load.posting?.pickupAt?.toISOString() ?? null,
      pickupDate: resolveLoadOrigin(load).pickupDate,
      vehicleNumber: load.vehicleNumber ?? null,
      ...fleetOwnerParams,
    },
  };

  return {
    message,
    metadata: {
      loadIds: [load.id],
      loadCode: load.code,
      from,
      to,
      pickupAt: formatPickup(load),
      vehicleNumber: load.vehicleNumber,
      fleetOwner,
      [DRIVER_MESSAGE_PARAMS_KEY]: message.params,
    },
  };
}
