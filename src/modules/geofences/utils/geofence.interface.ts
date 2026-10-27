import type { GeofenceEntity } from '../entities/geofence.entity';
import {
  GeofenceAlertChannel,
  GeofenceEventType,
  GeofenceShape,
  GeofenceType,
  GeoPoint,
} from './geofence.types';

export type GeofenceParams = { geofenceId: string };

/** A point as the geofence tests and distance helpers take it (GeoPoint is the stored form). */
export interface LatLng {
  lat: number;
  lng: number;
}

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

/** A geofence as the API returns it (GeofenceService). */
export interface GeofenceView {
  id: string;
  name: string;
  type: GeofenceType;
  address: string | null;
  latitude: number;
  longitude: number;
  shape: GeofenceShape;
  radiusM: number | null;
  polygon: GeoPoint[] | null;
  alerts: {
    onEnter: boolean;
    onExit: boolean;
    dwellMinutes: number | null;
    engineOnMinutes: number | null;
  };
  appliesTo: { allVehicles: boolean; vehicleIds: string[] };
  recipients: { userId: string; channels: GeofenceAlertChannel[] }[];
  loadingPointId: string | null;
  customerDeliveryPointId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Repository write shapes (GeofenceRepository). */
export type CreateGeofenceData = Omit<
  GeofenceEntity,
  'id' | 'vehicles' | 'recipients' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;
export type UpdateGeofenceData = Partial<Omit<CreateGeofenceData, 'tenantId' | 'createdBy'>>;

export interface ReplaceChildren {
  /** Undefined leaves the existing rows untouched; an array (even empty) replaces them. */
  vehicleIds?: string[];
  recipients?: { userId: string; channels: GeofenceAlertChannel[] }[];
}
