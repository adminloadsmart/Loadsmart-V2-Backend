import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { paginate } from './utils/masters.types';
import { LoadingPointRepository } from './loading-point.repository';
import { LoadingPointEntity } from './entities/loading-point.entity';
import {
  CreateLoadingPointInput,
  ListLoadingPointCitiesInput,
  ListLoadingPointsInput,
  UpdateLoadingPointInput,
} from './utils/loading-point.interface';

export class LoadingPointService {
  constructor(
    private readonly repository: LoadingPointRepository,
    private readonly auditService: AuditService,
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

      return await this.repository.create({
        tenantId,
        title: input.title.trim(),
        addressLine1: input.addressLine1.trim(),
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
    } catch (error) {
      rethrow(error, 'Failed to create loading point');
    }
  }

  async list(tenantId: string, input: ListLoadingPointsInput) {
    try {
      const result = await this.repository.list(tenantId, input);
      return paginate(result[0], result[1], input);
    } catch (error) {
      rethrow(error, 'Failed to list loading points');
    }
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
      const value = await this.repository.findById(tenantId, id);
      if (!value) throw new NotFoundError(`Loading point ${id} not found`);
      return value;
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

      const updated = await this.repository.update(tenantId, id, {
        title: input.title?.trim(),
        addressLine1: input.addressLine1?.trim(),
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

      return value;
    } catch (error) {
      rethrow(error, 'Failed to reject loading point');
    }
  }

  async delete(tenantId: string, actorId: string, id: string): Promise<void> {
    try {
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Loading point ${id} not found`);
      await this.repository.softDelete(tenantId, id, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete loading point');
    }
  }
}
