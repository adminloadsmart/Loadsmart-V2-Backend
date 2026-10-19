import { rethrow, NotFoundError, ValidationError } from '../../shared/errors';
import { paginate, Paginated } from '../../shared/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { GeofenceEntity } from './entities/geofence.entity';
import {
  CreateGeofenceData,
  GeofenceRepository,
  ReplaceChildren,
  UpdateGeofenceData,
} from './geofence.repository';
import {
  CreateGeofenceInput,
  GeofenceEventNotifier,
  GeofenceLoadAdvancer,
  GeofenceTransition,
  IngestPingsInput,
  IngestPingsResult,
  ListGeofencesInput,
  LocationPingInput,
  UpdateGeofenceInput,
} from './utils/geofence.interface';
import {
  GeofenceAlertChannel,
  GeofenceShape,
  GeofenceType,
  GeoPoint,
  LOAD_LINKED_GEOFENCE_TYPES,
} from './utils/geofence.types';
import { isInsideCircle, isInsidePolygon } from './utils/geo.util';

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

function toView(g: GeofenceEntity): GeofenceView {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    address: g.address,
    latitude: Number(g.latitude),
    longitude: Number(g.longitude),
    shape: g.shape,
    radiusM: g.radiusM,
    polygon: g.polygon,
    alerts: {
      onEnter: g.alertOnEnter,
      onExit: g.alertOnExit,
      dwellMinutes: g.dwellAlertMinutes,
      engineOnMinutes: g.engineOnAlertMinutes,
    },
    appliesTo: {
      allVehicles: g.appliesToAllVehicles,
      vehicleIds: (g.vehicles ?? []).map((v) => v.vehicleId),
    },
    recipients: (g.recipients ?? []).map((r) => ({ userId: r.userId, channels: r.channels })),
    loadingPointId: g.loadingPointId,
    customerDeliveryPointId: g.customerDeliveryPointId,
    isActive: g.isActive,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

function containsPoint(g: GeofenceEntity, point: GeoPoint): boolean {
  if (g.shape === 'polygon') return isInsidePolygon(point, g.polygon ?? []);
  const center = { latitude: Number(g.latitude), longitude: Number(g.longitude) };
  return isInsideCircle(point, center, g.radiusM ?? 0);
}

export class GeofenceService {
  constructor(
    private readonly repository: GeofenceRepository,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    /** Moves a vehicle's live load forward on entering a linked loading/unloading geofence.
     *  Optional so the module can be built (and tested) without the loads module. */
    private readonly advanceLoad?: GeofenceLoadAdvancer,
    private readonly notifyEvent?: GeofenceEventNotifier,
  ) {}

  async create(
    tenantId: string,
    actorId: string,
    input: CreateGeofenceInput,
  ): Promise<GeofenceView> {
    try {
      this.assertConsistent(input);
      await this.assertReferences(tenantId, input);

      const created = await this.repository.create(
        {
          tenantId,
          name: input.name,
          type: input.type,
          address: input.address ?? null,
          latitude: String(input.latitude),
          longitude: String(input.longitude),
          shape: input.shape,
          radiusM: input.shape === 'circle' ? (input.radiusM ?? null) : null,
          polygon: input.shape === 'polygon' ? (input.polygon ?? null) : null,
          alertOnEnter: input.alerts.onEnter,
          alertOnExit: input.alerts.onExit,
          dwellAlertMinutes: input.alerts.dwellMinutes ?? null,
          engineOnAlertMinutes: input.alerts.engineOnMinutes ?? null,
          appliesToAllVehicles: input.appliesTo.allVehicles,
          loadingPointId: input.loadingPointId ?? null,
          customerDeliveryPointId: input.customerDeliveryPointId ?? null,
          isActive: input.isActive ?? true,
          createdBy: actorId,
          updatedBy: actorId,
        } satisfies CreateGeofenceData,
        {
          vehicleIds: input.appliesTo.allVehicles ? [] : (input.appliesTo.vehicleIds ?? []),
          recipients: input.recipients,
        },
      );
      const view = toView(created);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'GEOFENCE_CREATED',
        resourceType: 'geofence',
        newData: { id: view.id, name: view.name, type: view.type },
      });
      return view;
    } catch (error) {
      rethrow(error, 'Failed to create geofence');
    }
  }

  async list(tenantId: string, input: ListGeofencesInput): Promise<Paginated<GeofenceView>> {
    try {
      const [items, total] = await this.repository.list(tenantId, input);
      return paginate(items.map(toView), total, input);
    } catch (error) {
      rethrow(error, 'Failed to list geofences');
    }
  }

  async get(tenantId: string, id: string): Promise<GeofenceView> {
    try {
      return toView(await this.assertExists(tenantId, id));
    } catch (error) {
      rethrow(error, 'Failed to fetch geofence');
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    input: UpdateGeofenceInput,
  ): Promise<GeofenceView> {
    try {
      const existing = await this.assertExists(tenantId, id);
      const current = toView(existing);

      // Merge over the stored row so the cross-field rules see the geofence as it will be.
      const merged: CreateGeofenceInput = {
        name: input.name ?? current.name,
        type: input.type ?? current.type,
        address: input.address !== undefined ? input.address : current.address,
        latitude: input.latitude ?? current.latitude,
        longitude: input.longitude ?? current.longitude,
        shape: input.shape ?? current.shape,
        radiusM: input.radiusM !== undefined ? input.radiusM : current.radiusM,
        polygon: input.polygon !== undefined ? input.polygon : current.polygon,
        alerts: input.alerts ?? {
          onEnter: current.alerts.onEnter,
          onExit: current.alerts.onExit,
          dwellMinutes: current.alerts.dwellMinutes,
          engineOnMinutes: current.alerts.engineOnMinutes,
        },
        appliesTo: input.appliesTo ?? current.appliesTo,
        recipients: input.recipients ?? current.recipients,
        loadingPointId:
          input.loadingPointId !== undefined ? input.loadingPointId : current.loadingPointId,
        customerDeliveryPointId:
          input.customerDeliveryPointId !== undefined
            ? input.customerDeliveryPointId
            : current.customerDeliveryPointId,
        isActive: input.isActive ?? current.isActive,
      };
      this.assertConsistent(merged);
      await this.assertReferences(tenantId, {
        ...input,
        recipients: input.recipients,
        appliesTo: input.appliesTo,
      });

      const data: UpdateGeofenceData = {
        name: merged.name,
        type: merged.type,
        address: merged.address ?? null,
        latitude: String(merged.latitude),
        longitude: String(merged.longitude),
        shape: merged.shape,
        radiusM: merged.shape === 'circle' ? (merged.radiusM ?? null) : null,
        polygon: merged.shape === 'polygon' ? (merged.polygon ?? null) : null,
        alertOnEnter: merged.alerts.onEnter,
        alertOnExit: merged.alerts.onExit,
        dwellAlertMinutes: merged.alerts.dwellMinutes ?? null,
        engineOnAlertMinutes: merged.alerts.engineOnMinutes ?? null,
        appliesToAllVehicles: merged.appliesTo.allVehicles,
        loadingPointId: merged.loadingPointId ?? null,
        customerDeliveryPointId: merged.customerDeliveryPointId ?? null,
        isActive: merged.isActive ?? true,
        updatedBy: actorId,
      };
      const children: ReplaceChildren = {};
      if (input.appliesTo) {
        children.vehicleIds = input.appliesTo.allVehicles ? [] : (input.appliesTo.vehicleIds ?? []);
      }
      if (input.recipients) children.recipients = input.recipients;

      const updated = await this.repository.update(tenantId, id, data, children);
      if (!updated) throw new NotFoundError(`Geofence ${id} not found`);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'GEOFENCE_UPDATED',
        resourceType: 'geofence',
        oldData: { id, name: current.name, type: current.type },
        newData: { id, name: merged.name, type: merged.type },
      });
      return toView(updated);
    } catch (error) {
      rethrow(error, 'Failed to update geofence');
    }
  }

  async delete(tenantId: string, actorId: string, id: string): Promise<void> {
    try {
      const existing = await this.assertExists(tenantId, id);
      await this.repository.softDelete(tenantId, id);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'GEOFENCE_DELETED',
        resourceType: 'geofence',
        oldData: { id, name: existing.name, type: existing.type },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete geofence');
    }
  }

  /**
   * Location-ping ingestion. Per vehicle only the newest ping in the batch counts. Each applicable
   * geofence is tested; only a *change* of inside/outside state is an event, so repeated pings
   * from the same place never re-fire. An enter on a linked loading/unloading geofence advances
   * the vehicle's live load. A vehicle first seen outside a geofence records state but no event.
   */
  async processPings(tenantId: string, input: IngestPingsInput): Promise<IngestPingsResult> {
    try {
      const latest = new Map<string, LocationPingInput>();
      for (const ping of input.pings) {
        const seen = latest.get(ping.vehicleId);
        if (!seen || Date.parse(ping.recordedAt) > Date.parse(seen.recordedAt)) {
          latest.set(ping.vehicleId, ping);
        }
      }

      const vehicleIds = [...latest.keys()];
      const known = await this.repository.findExistingVehicleIds(tenantId, vehicleIds);
      const unknownVehicleIds = vehicleIds.filter((id) => !known.has(id));
      const knownIds = vehicleIds.filter((id) => known.has(id));
      if (knownIds.length === 0) return { processed: 0, unknownVehicleIds, transitions: [] };

      const geofences = await this.repository.findActiveForTenant(tenantId);
      const states = await this.repository.findStates(tenantId, knownIds);
      const stateOf = new Map(states.map((s) => [`${s.vehicleId}:${s.geofenceId}`, s]));
      const transitions: GeofenceTransition[] = [];

      for (const vehicleId of knownIds) {
        const ping = latest.get(vehicleId)!;
        const at = new Date(ping.recordedAt);
        const point = { latitude: ping.latitude, longitude: ping.longitude };

        for (const geofence of geofences) {
          const applies =
            geofence.appliesToAllVehicles ||
            geofence.vehicles.some((v) => v.vehicleId === vehicleId);
          if (!applies) continue;

          const state = stateOf.get(`${vehicleId}:${geofence.id}`);
          if (state && state.lastPingAt.getTime() >= at.getTime()) continue; // stale / duplicate

          const inside = containsPoint(geofence, point);
          const wasInside = state?.inside ?? false;
          await this.repository.saveState({
            tenantId,
            vehicleId,
            geofenceId: geofence.id,
            inside,
            enteredAt: inside ? (wasInside ? (state?.enteredAt ?? at) : at) : null,
            lastPingAt: at,
          });
          if (inside === wasInside) continue;

          const event = inside ? 'enter' : 'exit';
          let loadId: string | null = null;
          let loadStatus: string | null = null;

          if (
            event === 'enter' &&
            this.advanceLoad &&
            (LOAD_LINKED_GEOFENCE_TYPES as readonly string[]).includes(geofence.type)
          ) {
            try {
              const advanced = await this.advanceLoad({
                tenantId,
                vehicleId,
                geofenceId: geofence.id,
                geofenceType: geofence.type as 'loading_point' | 'unloading_point',
                loadingPointId: geofence.loadingPointId,
                customerDeliveryPointId: geofence.customerDeliveryPointId,
              });
              loadId = advanced?.loadId ?? null;
              loadStatus = advanced?.toStatus ?? null;
            } catch (error) {
              // The ping and its event are already recorded — a load that can't move (e.g. on
              // hold after an incident) must not fail the whole ingestion batch.
              console.warn(
                `Geofence ${geofence.id}: could not advance load for vehicle ${vehicleId}`,
                error,
              );
            }
          }

          await this.repository.createEvent({
            tenantId,
            geofenceId: geofence.id,
            vehicleId,
            loadId,
            event,
            latitude: String(ping.latitude),
            longitude: String(ping.longitude),
            occurredAt: at,
          });
          transitions.push({
            geofenceId: geofence.id,
            geofenceName: geofence.name,
            vehicleId,
            event,
            loadId,
            loadStatus,
          });

          const alertWanted = event === 'enter' ? geofence.alertOnEnter : geofence.alertOnExit;
          if (alertWanted && geofence.recipients.length > 0) {
            await this.notifyEvent?.({
              tenantId,
              geofenceId: geofence.id,
              geofenceName: geofence.name,
              vehicleId,
              vehicleNumber: await this.repository.findVehicleNumber(tenantId, vehicleId),
              event,
              loadId,
              recipients: geofence.recipients.map((r) => ({
                userId: r.userId,
                channels: r.channels,
              })),
              at,
            });
          }
        }
      }

      return { processed: knownIds.length, unknownVehicleIds, transitions };
    } catch (error) {
      rethrow(error, 'Failed to process location pings');
    }
  }

  private async assertExists(tenantId: string, id: string): Promise<GeofenceEntity> {
    const geofence = await this.repository.findById(tenantId, id);
    if (!geofence) throw new NotFoundError(`Geofence ${id} not found`);
    return geofence;
  }

  /** Cross-field rules, applied to the full (merged) geofence on create and PATCH alike. */
  private assertConsistent(g: CreateGeofenceInput): void {
    if (g.shape === 'circle' && !g.radiusM) {
      throw new ValidationError('radiusM is required for a circle geofence');
    }
    if (g.shape === 'polygon' && (!g.polygon || g.polygon.length < 3)) {
      throw new ValidationError('polygon needs at least 3 points for a polygon geofence');
    }
    if (!g.appliesTo.allVehicles && (g.appliesTo.vehicleIds ?? []).length === 0) {
      throw new ValidationError('Choose at least one truck, or apply the geofence to all trucks');
    }
    const loadLinked = (LOAD_LINKED_GEOFENCE_TYPES as readonly string[]).includes(g.type);
    if (!loadLinked && (g.loadingPointId || g.customerDeliveryPointId)) {
      throw new ValidationError(
        'Only loading point and unloading point geofences can be linked to a master point',
      );
    }
    if (g.type === 'loading_point' && g.customerDeliveryPointId) {
      throw new ValidationError('A loading point geofence links to a loading point only');
    }
  }

  /** Tenant-scoped existence of every id the request references. */
  private async assertReferences(
    tenantId: string,
    input: Partial<CreateGeofenceInput>,
  ): Promise<void> {
    const vehicleIds = input.appliesTo?.allVehicles ? [] : (input.appliesTo?.vehicleIds ?? []);
    if (vehicleIds.length > 0) {
      const found = await this.repository.findExistingVehicleIds(tenantId, vehicleIds);
      const missing = vehicleIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new ValidationError(`Unknown vehicles: ${missing.join(', ')}`);
    }
    if (
      input.loadingPointId &&
      !(await this.repository.loadingPointExists(tenantId, input.loadingPointId))
    ) {
      throw new ValidationError('Loading point not found');
    }
    if (
      input.customerDeliveryPointId &&
      !(await this.repository.deliveryPointExists(tenantId, input.customerDeliveryPointId))
    ) {
      throw new ValidationError('Customer delivery point not found');
    }
    const recipientIds = (input.recipients ?? []).map((r) => r.userId);
    if (recipientIds.length > 0) {
      const users = await this.authService.getUsersByIds(recipientIds);
      const inTenant = new Set(users.filter((u) => u.tenantId === tenantId).map((u) => u.id));
      const missing = recipientIds.filter((id) => !inTenant.has(id));
      if (missing.length > 0)
        throw new ValidationError(`Unknown recipients: ${missing.join(', ')}`);
    }
  }
}
