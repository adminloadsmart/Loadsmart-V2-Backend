import {
  GeofenceAlertChannel,
  GeofenceEventType,
  GeofenceShape,
  GeofenceType,
  GeoPoint,
} from './geofence.types';

export type GeofenceParams = { geofenceId: string };

export interface GeofenceRecipientInput {
  userId: string;
  channels: GeofenceAlertChannel[];
}

export interface GeofenceAlertsInput {
  onEnter: boolean;
  onExit: boolean;
  /** "A truck stays longer than" — stored now, evaluated by a later dwell job. */
  dwellMinutes?: number | null;
  /** "Engine runs inside for more than" — stored now, evaluated by a later job. */
  engineOnMinutes?: number | null;
}

export interface GeofenceAppliesToInput {
  allVehicles: boolean;
  vehicleIds?: string[];
}

export interface CreateGeofenceInput {
  name: string;
  type: GeofenceType;
  address?: string | null;
  latitude: number;
  longitude: number;
  shape: GeofenceShape;
  radiusM?: number | null;
  polygon?: GeoPoint[] | null;
  alerts: GeofenceAlertsInput;
  appliesTo: GeofenceAppliesToInput;
  recipients: GeofenceRecipientInput[];
  /** Master loading point this geofence stands for — needed for load-status automation. */
  loadingPointId?: string | null;
  /** Customer delivery point this geofence stands for — needed for load-status automation. */
  customerDeliveryPointId?: string | null;
  isActive?: boolean;
}

export type UpdateGeofenceInput = Partial<CreateGeofenceInput>;

export interface ListGeofencesInput {
  page: number;
  limit: number;
  search?: string;
  type?: GeofenceType;
  isActive?: boolean;
}

export interface LocationPingInput {
  vehicleId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  ignitionOn?: boolean;
}

export interface IngestPingsInput {
  pings: LocationPingInput[];
}

export interface GeofenceTransition {
  geofenceId: string;
  geofenceName: string;
  vehicleId: string;
  event: GeofenceEventType;
  loadId: string | null;
  /** Set when this entry moved the load's status. */
  loadStatus: string | null;
}

export interface IngestPingsResult {
  processed: number;
  /** Vehicle ids that aren't in this tenant (or are deleted) — their pings were dropped. */
  unknownVehicleIds: string[];
  transitions: GeofenceTransition[];
}

/** What the geofences module needs from the loads module — kept narrow so geofences never reaches
 *  into load repositories. Implemented by LoadService.advanceFromGeofence. */
export interface GeofenceLoadAdvance {
  tenantId: string;
  vehicleId: string;
  geofenceId: string;
  geofenceType: 'loading_point' | 'unloading_point';
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
}

export interface GeofenceLoadAdvanceResult {
  loadId: string;
  loadCode: string;
  fromStatus: string;
  /** Null when the vehicle's load matched but wasn't in a state to move. */
  toStatus: string | null;
}

export type GeofenceLoadAdvancer = (
  input: GeofenceLoadAdvance,
) => Promise<GeofenceLoadAdvanceResult | null>;

/** Fires after an enter/exit transition has been recorded. Never throws — same contract as
 *  LoadEventNotifier. */
export interface GeofenceAlertEvent {
  tenantId: string;
  geofenceId: string;
  geofenceName: string;
  vehicleId: string;
  vehicleNumber: string | null;
  event: GeofenceEventType;
  loadId: string | null;
  recipients: GeofenceRecipientInput[];
  at: Date;
}
export type GeofenceEventNotifier = (event: GeofenceAlertEvent) => Promise<void>;
