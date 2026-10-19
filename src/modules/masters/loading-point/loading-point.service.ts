import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../../shared/utils/pagination';
import { LoadingPointRepository, LoadingPointWithCreator } from './loading-point.repository';
import { LoadingPointEntity } from './entities/loading-point.entity';
import { MasterApprovalNotifier } from '../../notifications/master-approvals';
import { MasterUsageRepository } from '../masters.usage';
import { MasterRecordSource } from '../transporter/transporter.types';
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  resolveLocationSource,
} from '../../../shared/constants/location-source';
import { buildCsv, CSV_EXPORT_MAX_ROWS, CsvColumn } from '../../../shared/utils/csv';
import {
  CreateLoadingPointInput,
  ListLoadingPointCitiesInput,
  ListLoadingPointsInput,
  UpdateLoadingPointInput,
} from './loading-point.interface';

/** A loading point as Settings → Loading Points reads it: every column plus the creator's name
 *  and the "Shared master" (Google Places pin) / "Own record" (typed in) badge. */
export function toLoadingPointView(point: LoadingPointWithCreator) {
  const { createdByUser, ...rest } = point;
  const recordSource: MasterRecordSource =
    point.locationSource === 'google_places' ? 'shared_master' : 'own_record';
  return {
    ...rest,
    createdByUser: createdByUser
      ? { id: createdByUser.id, fullName: createdByUser.fullName }
      : null,
    recordSource,
  };
}

const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null);

/** Headers match the bulk-upload columns so an export can be edited and uploaded back. */
const LOADING_POINT_EXPORT_COLUMNS: CsvColumn<ReturnType<typeof toLoadingPointView>>[] = [
  { header: 'title', value: (p) => p.title },
  { header: 'addressLine1', value: (p) => p.addressLine1 },
  { header: 'city', value: (p) => p.city },
  { header: 'state', value: (p) => p.state },
  { header: 'pinCode', value: (p) => p.pinCode },
  { header: 'latitude', value: (p) => p.latitude },
  { header: 'longitude', value: (p) => p.longitude },
  { header: 'geofenceRadiusM', value: (p) => p.geofenceRadiusM },
  { header: 'gateOpensAt', value: (p) => hhmm(p.gateOpensAt) },
  { header: 'gateClosesAt', value: (p) => hhmm(p.gateClosesAt) },
  { header: 'contactPersonName', value: (p) => p.contactPersonName },
  { header: 'contactPersonNumber', value: (p) => p.contactPersonNumber },
  { header: 'contactPersonEmail', value: (p) => p.contactPersonEmail },
  { header: 'notes', value: (p) => p.notes },
  { header: 'status', value: (p) => p.status },
  { header: 'source', value: (p) => p.locationSource },
];

export class LoadingPointService {
  constructor(
    private readonly repository: LoadingPointRepository,
    private readonly auditService: AuditService,
    private readonly usage: MasterUsageRepository,
    // LS_N_0009/0010 — optional; only queues a notification after the existing logic and never
    // throws (see notifications/master-approvals.ts).
    private readonly approvalNotifier?: MasterApprovalNotifier,
  ) {}

  /** org_admin's own loading point lands `active` immediately; dispatch's (the only other role
   * masters.routes.ts's canWrite gate admits) lands `pending` until an org_admin reviews it via
   * approve/reject — same split as VehicleService.createVehicle / DriverService.createDriver. */
  async create(
    tenantId: string,
    actorId: string,
    actorRole: string,
    input: CreateLoadingPointInput,
  ): Promise<LoadingPointEntity> {
    try {
      const autoApproved = actorRole === ORG_ADMIN_ROLE;

      const value = await this.repository.create({
        tenantId,
        title: input.title.trim(),
        addressLine1: input.addressLine1?.trim() || null,
        googlePlaceId: input.googlePlaceId?.trim() ?? null,
        locationSource: resolveLocationSource(input),
        geofenceRadiusM: input.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
        gateOpensAt: input.gateOpensAt ?? null,
        gateClosesAt: input.gateClosesAt ?? null,
        notes: input.notes?.trim() || null,
        addressLine2: input.addressLine2?.trim() ?? null,
        landmark: input.landmark?.trim() ?? null,
        areaLocality: input.areaLocality?.trim() ?? null,
        city: input.city.trim(),
        state: input.state.trim(),
        pinCode: input.pinCode.trim(),
        latitude: input.latitude === undefined ? null : String(input.latitude),
        longitude: input.longitude === undefined ? null : String(input.longitude),
        contactPersonName: input.contactPersonName?.trim() ?? null,
        contactPersonNumber: input.contactPersonNumber?.trim() ?? null,
        contactPersonEmail: input.contactPersonEmail?.trim() ?? null,
        status: autoApproved ? 'active' : 'pending',
        approvedBy: autoApproved ? actorId : null,
        approvedAt: autoApproved ? new Date() : null,
        rejectionReason: null,
        createdBy: actorId,
      });
      await this.approvalNotifier?.requested({
        kind: 'loading_point',
        tenantId,
        recordId: value.id,
        masterValue: value.title,
        createdBy: value.createdBy,
        pending: value.status === 'pending',
      });
      return value;
    } catch (error) {
      rethrow(error, 'Failed to create loading point');
    }
  }

  async list(tenantId: string, input: ListLoadingPointsInput) {
    try {
      const result = await this.repository.list(tenantId, input);
      return paginate(result[0].map(toLoadingPointView), result[1], input);
    } catch (error) {
      rethrow(error, 'Failed to list loading points');
    }
  }

  async export(
    tenantId: string,
    filters: Omit<ListLoadingPointsInput, 'page' | 'limit'>,
  ): Promise<string> {
    try {
      const items = await this.repository.listForExport(tenantId, filters, CSV_EXPORT_MAX_ROWS);
      return buildCsv(LOADING_POINT_EXPORT_COLUMNS, items.map(toLoadingPointView));
    } catch (error) {
      rethrow(error, 'Failed to export loading points');
    }
  }

  /** "In use right now. LOAD-1049 is still running." — the Retire drawer checks this first. */
  async usageOf(tenantId: string, id: string) {
    try {
      const value = await this.repository.findById(tenantId, id);
      if (!value) throw new NotFoundError(`Loading point ${id} not found`);
      const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'loading_point', id });
      return { inUse: activeLoads.length > 0, activeLoads };
    } catch (error) {
      rethrow(error, 'Failed to check loading point usage');
    }
  }

  private async assertNotInUse(tenantId: string, id: string, action: string) {
    const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'loading_point', id });
    if (activeLoads.length)
      throw new ConflictError(
        `Loading point is in use right now — ${activeLoads[0].code} is still running, so it cannot be ${action}`,
        { activeLoads },
      );
  }

  async listCities(tenantId: string, input: ListLoadingPointCitiesInput): Promise<string[]> {
    try {
      return await this.repository.listCities(tenantId, input);
    } catch (error) {
      rethrow(error, 'Failed to list loading point cities');
    }
  }

  async get(tenantId: string, id: string) {
    try {
      const value = await this.repository.findWithCreator(tenantId, id);
      if (!value) throw new NotFoundError(`Loading point ${id} not found`);
      return toLoadingPointView(value);
    } catch (error) {
      rethrow(error, 'Failed to fetch loading point');
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    input: UpdateLoadingPointInput,
  ): Promise<LoadingPointEntity> {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Loading point ${id} not found`);
      if (input.status === 'inactive' && existing.status !== 'inactive')
        await this.assertNotInUse(tenantId, id, 'retired');

      // The pin source follows whatever place id / pin the point ends up with after this edit.
      const pinTouched =
        input.googlePlaceId !== undefined ||
        input.latitude !== undefined ||
        input.longitude !== undefined;
      const locationSource = pinTouched
        ? resolveLocationSource({
            googlePlaceId:
              input.googlePlaceId === undefined ? existing.googlePlaceId : input.googlePlaceId,
            latitude: input.latitude === undefined ? existing.latitude : input.latitude,
            longitude: input.longitude === undefined ? existing.longitude : input.longitude,
          })
        : undefined;

      const updated = await this.repository.update(tenantId, id, {
        title: input.title?.trim(),
        addressLine1:
          input.addressLine1 === undefined ? undefined : input.addressLine1?.trim() || null,
        googlePlaceId:
          input.googlePlaceId === undefined ? undefined : input.googlePlaceId?.trim() || null,
        locationSource,
        geofenceRadiusM: input.geofenceRadiusM ?? undefined,
        gateOpensAt: input.gateOpensAt,
        gateClosesAt: input.gateClosesAt,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        addressLine2:
          input.addressLine2 === undefined ? undefined : (input.addressLine2?.trim() ?? null),
        landmark: input.landmark === undefined ? undefined : (input.landmark?.trim() ?? null),
        areaLocality:
          input.areaLocality === undefined ? undefined : (input.areaLocality?.trim() ?? null),
        city: input.city?.trim(),
        state: input.state?.trim(),
        pinCode: input.pinCode?.trim(),
        latitude:
          input.latitude === undefined
            ? undefined
            : input.latitude === null
              ? null
              : String(input.latitude),
        longitude:
          input.longitude === undefined
            ? undefined
            : input.longitude === null
              ? null
              : String(input.longitude),
        contactPersonName:
          input.contactPersonName === undefined
            ? undefined
            : (input.contactPersonName?.trim() ?? null),
        contactPersonNumber:
          input.contactPersonNumber === undefined
            ? undefined
            : (input.contactPersonNumber?.trim() ?? null),
        contactPersonEmail:
          input.contactPersonEmail === undefined
            ? undefined
            : (input.contactPersonEmail?.trim() ?? null),
        status: input.status,
        updatedBy: actorId,
      });

      if (!updated) throw new NotFoundError(`Loading point ${id} not found`);
      if (input.status && input.status !== existing.status)
        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'LOADING_POINT_STATUS_UPDATED',
          resourceType: 'loading_point',
          oldData: { id, status: existing.status },
          newData: { id, status: input.status },
        });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update loading point');
    }
  }

  async approve(tenantId: string, actorId: string, id: string) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Loading point ${id} not found`);
      if (existing.status !== 'pending')
        throw new ConflictError('Only pending loading points can be approved');
      const value = await this.repository.approve(tenantId, id, actorId);
      if (!value) throw new ConflictError('Loading point approval failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOADING_POINT_APPROVED',
        resourceType: 'loading_point',
        oldData: { id, status: 'pending' },
        newData: { id, status: 'active', approvedBy: actorId },
      });
      await this.approvalNotifier?.approved({
        kind: 'loading_point',
        tenantId,
        recordId: value.id,
        masterValue: value.title,
        createdBy: value.createdBy,
        approvedBy: actorId,
      });

      return value;
    } catch (error) {
      rethrow(error, 'Failed to approve loading point');
    }
  }

  async reject(tenantId: string, actorId: string, id: string, reason: string) {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Loading point ${id} not found`);
      if (existing.status !== 'pending')
        throw new ConflictError('Only pending loading points can be rejected');
      const value = await this.repository.reject(tenantId, id, actorId, reason);
      if (!value) throw new ConflictError('Loading point rejection failed');

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOADING_POINT_REJECTED',
        resourceType: 'loading_point',
        oldData: { id, status: 'pending' },
        newData: { id, status: 'rejected', rejectionReason: reason },
      });
      await this.approvalNotifier?.rejected({
        kind: 'loading_point',
        tenantId,
        recordId: value.id,
        masterValue: value.title,
        createdBy: value.createdBy,
        rejectedBy: actorId,
        reason,
      });

      return value;
    } catch (error) {
      rethrow(error, 'Failed to reject loading point');
    }
  }

  async delete(tenantId: string, actorId: string, id: string): Promise<void> {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Loading point ${id} not found`);
      await this.assertNotInUse(tenantId, id, 'deleted');
      await this.repository.softDelete(tenantId, id, actorId);
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOADING_POINT_DELETED',
        resourceType: 'loading_point',
        oldData: { id, title: existing.title, status: existing.status },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete loading point');
    }
  }
}
