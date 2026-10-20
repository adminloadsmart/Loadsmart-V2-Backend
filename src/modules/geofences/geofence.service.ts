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
  GeofenceTransitionNotice,
  ListGeofencesInput,
  UpdateGeofenceInput,
} from './utils/geofence.interface';
import {
  GeofenceAlertChannel,
  GeofenceShape,
  GeofenceType,
  GeoPoint,
  LOAD_LINKED_GEOFENCE_TYPES,
} from './utils/geofence.types';

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

export class GeofenceService {
  constructor(
    private readonly repository: GeofenceRepository,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
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
   * Tracking detected an enter/exit (tracking.events `geofence.entered` / `geofence.exited` — the
   * inside/outside check runs in the tracking service, against these same geofences). Sends the
   * geofence's own "Send alerts to" notice when that direction is switched on. A geofence deleted
   * or switched off since is skipped. Load status changes arrive as their own trip events.
   */
  async notifyTransition(notice: GeofenceTransitionNotice): Promise<void> {
    try {
      const geofence = await this.repository.findById(notice.tenantId, notice.geofenceId);
      if (!geofence || !geofence.isActive || !this.notifyEvent) return;
      const alertWanted = notice.event === 'enter' ? geofence.alertOnEnter : geofence.alertOnExit;
      if (!alertWanted || geofence.recipients.length === 0) return;
      await this.notifyEvent({
        tenantId: notice.tenantId,
        geofenceId: geofence.id,
        geofenceName: geofence.name,
        vehicleId: notice.vehicleId,
        vehicleNumber:
          notice.vehicleNumber ??
          (await this.repository.findVehicleNumber(notice.tenantId, notice.vehicleId)),
        event: notice.event,
        loadId: notice.loadId,
        recipients: geofence.recipients.map((r) => ({ userId: r.userId, channels: r.channels })),
        at: notice.at,
      });
    } catch (error) {
      rethrow(error, 'Failed to send the geofence alert');
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
