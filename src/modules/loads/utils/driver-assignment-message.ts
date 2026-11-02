import type { FleetOwnerDetails } from '../../auth/auth.service';
import { LoadEntity } from '../entities/load.entity';
import { resolveLoadOrigin } from './load-origin';

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

const ownerLine = (owner: FleetOwnerDetails | null): string | null => {
  const contact = owner?.owner ?? owner?.dispatch;
  if (!contact) return null;
  const name = contact.name ?? owner?.organizationName ?? 'Fleet owner';
  return `Fleet owner: ${name} (${contact.phoneNumber})`;
};

/**
 * The driver's "New load assigned" push: the load, route, pickup and truck, then who to call.
 * `loads` needs the origin relations loaded (LoadRepository.findDetailById). With more than one
 * load the body is a count — each one is in the app.
 */
export function driverAssignmentMessage(loads: LoadEntity[], owner: FleetOwnerDetails | null) {
  const ownerText = ownerLine(owner);
  const fleetOwner = owner
    ? {
        organizationName: owner.organizationName,
        name: (owner.owner ?? owner.dispatch)?.name ?? null,
        phoneNumber: (owner.owner ?? owner.dispatch)?.phoneNumber ?? null,
      }
    : null;

  if (loads.length !== 1) {
    return {
      body: [`${loads.length} loads have been assigned to you`, ownerText]
        .filter(Boolean)
        .join('. '),
      metadata: { loadIds: loads.map((load) => load.id), fleetOwner },
    };
  }

  const [load] = loads;
  const { pickup, drop } = resolveLoadOrigin(load);
  const from = pickup?.city ?? pickup?.title ?? null;
  const to = drop?.city ?? drop?.location ?? null;
  const route = from && to ? `${from} → ${to}` : null;
  const pickupAt = formatPickup(load);
  const details = [
    route,
    pickupAt ? `Pickup ${pickupAt}` : null,
    load.vehicleNumber ? `Truck ${load.vehicleNumber}` : null,
  ].filter(Boolean);

  return {
    body: [
      `Load ${load.code} has been assigned to you${details.length ? `: ${details.join(' · ')}` : ''}`,
      ownerText,
    ]
      .filter(Boolean)
      .join('. '),
    metadata: {
      loadIds: [load.id],
      loadCode: load.code,
      from,
      to,
      pickupAt,
      vehicleNumber: load.vehicleNumber,
      fleetOwner,
    },
  };
}
