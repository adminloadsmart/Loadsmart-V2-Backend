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

/** A `geofence.entered` / `geofence.exited` event from tracking (tracking-events.consumer.ts). */
export interface GeofenceTransitionNotice {
  tenantId: string;
  geofenceId: string;
  vehicleId: string;
  /** Tracking's plate for the truck, when it knows it (market trucks have no vehicle row). */
  vehicleNumber: string | null;
  event: GeofenceEventType;
  loadId: string | null;
  at: Date;
}

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
