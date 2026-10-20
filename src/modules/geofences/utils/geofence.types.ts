// Closed value sets for the geofences module — const tuples, same pattern as loads.types.ts.

export const GEOFENCE_TYPES = [
  'yard',
  'loading_point',
  'unloading_point',
  'fuel_pump',
  'no_go_area',
  'rest_stop',
  'toll_plaza',
] as const;
export type GeofenceType = (typeof GEOFENCE_TYPES)[number];

/** Places a truck is expected to stand — a long halt inside one is not alerted (LS_N_0027). */
export const HALT_EXPECTED_GEOFENCE_TYPES = ['rest_stop', 'toll_plaza'] as const;
export type HaltExpectedGeofenceType = (typeof HALT_EXPECTED_GEOFENCE_TYPES)[number];

/** Types a load's status is driven by — entering one of these advances the vehicle's live load. */
export const LOAD_LINKED_GEOFENCE_TYPES = ['loading_point', 'unloading_point'] as const;

export const GEOFENCE_SHAPES = ['circle', 'polygon'] as const;
export type GeofenceShape = (typeof GEOFENCE_SHAPES)[number];

export const GEOFENCE_EVENT_TYPES = ['enter', 'exit'] as const;
export type GeofenceEventType = (typeof GEOFENCE_EVENT_TYPES)[number];

export const GEOFENCE_ALERT_CHANNELS = ['app', 'whatsapp', 'email'] as const;
export type GeofenceAlertChannel = (typeof GEOFENCE_ALERT_CHANNELS)[number];

export const MIN_GEOFENCE_RADIUS_M = 50;
export const MAX_GEOFENCE_RADIUS_M = 5000;
export const MIN_POLYGON_POINTS = 3;
export const MAX_POLYGON_POINTS = 100;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}
