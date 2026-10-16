import {
  DEFAULT_REPORTING_TIME_IST,
  INDIA_TIME_ZONE,
  INDIA_UTC_OFFSET_MS,
} from '../notifications.constants';

/** When the vehicle is due at the loading point: a posting's pickup time, else the requisition's
 *  pickup date at DEFAULT_REPORTING_TIME_IST — loads don't capture a reporting time yet.
 *  LoadAlertRepository.findAssignedLoadsDueBetween applies the same rule in SQL. */
export function reportingAtOf(pickupAt: Date | null, pickupDate: string | null): Date | null {
  if (pickupAt) return pickupAt;
  if (!pickupDate) return null;
  return new Date(
    Date.parse(`${pickupDate}T${DEFAULT_REPORTING_TIME_IST}:00Z`) - INDIA_UTC_OFFSET_MS,
  );
}

/** "17 Oct, 14:30" in India time. */
export function formatIndiaDateTime(at: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
}

/** Straight-line km between two points, rounded — "last seen N km away" (LS_N_0021). */
export function distanceKmBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const EARTH_RADIUS_KM = 6371;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
