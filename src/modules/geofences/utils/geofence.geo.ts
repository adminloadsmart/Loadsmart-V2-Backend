import { distanceMetresBetween } from '../../notifications/utils/trip-time';
import { GeofenceShape, GeoPoint } from './geofence.types';
import { LatLng } from './geofence.interface';

/** The parts of a geofence a point test needs (numeric columns already parsed). */
export interface GeofenceArea {
  shape: GeofenceShape;
  lat: number;
  lng: number;
  radiusM: number | null;
  polygon: GeoPoint[] | null;
}

/** Inside a geofence: within the circle's radius, or inside the drawn polygon — the same test the
 *  tracking service runs on every GPS point (its geofence.geo.ts). */
export function geofenceContains(area: GeofenceArea, point: LatLng): boolean {
  if (area.shape === 'polygon') return isInsidePolygon(point, area.polygon ?? []);
  return distanceMetresBetween(point, area) <= (area.radiusM ?? 0);
}

/** Ray-casting point-in-polygon on lat/lng treated as planar — accurate for the site-sized
 *  shapes (a few km at most) a geofence is drawn at. Vertices are in drawing order. */
function isInsidePolygon(point: LatLng, polygon: GeoPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vertex = polygon[i];
    const previousVertex = polygon[j];
    const crosses =
      vertex.latitude > point.lat !== previousVertex.latitude > point.lat &&
      point.lng <
        ((previousVertex.longitude - vertex.longitude) * (point.lat - vertex.latitude)) /
          (previousVertex.latitude - vertex.latitude) +
          vertex.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}
