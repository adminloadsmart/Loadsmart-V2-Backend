import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditService } from '../audit/audit.service';
import { paginate } from './utils/masters.types';
import { TransporterRepository } from './transporter.repository';
import {
  CreateTransporterInput,
  ListTransportersInput,
  UpdateTransporterInput,
} from './utils/transporter.interface';

export class TransporterService {
  constructor(
    private readonly repository: TransporterRepository,
    private readonly audit: AuditService,
  ) {}
  private assertAdmin(role: string) {
    if (role !== ORG_ADMIN_ROLE)
      throw new AuthorizationError('Only organization admins can manage transporters');
  }
  async create(tenantId: string, actorId: string, role: string, input: CreateTransporterInput) {
    try {
      this.assertAdmin(role);
      const name = input.name.trim();
      if (await this.repository.findByName(tenantId, name))
        throw new ConflictError(`A transporter named "${name}" already exists`);
      const transporter = await this.repository.create({
        ...input,
        name,
        tenantId,
        createdBy: actorId,
      });
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CREATED',
        resourceType: 'transporter',
        newData: this.snapshot(transporter),
      });
      return transporter;
    } catch (error) {
      rethrow(error, 'Failed to create transporter');
    }
  }
  async list(tenantId: string, role: string, input: ListTransportersInput) {
    try {
      this.assertAdmin(role);
      const result = await this.repository.list(tenantId, input);
      return paginate(result.items, result.total, input);
    } catch (error) {
      rethrow(error, 'Failed to list transporters');
    }
  }
  async update(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    input: UpdateTransporterInput,
  ) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Transporter ${id} not found`);
      const name = input.name?.trim();
      if (name && name !== existing.name && (await this.repository.findByName(tenantId, name)))
        throw new ConflictError(`A transporter named "${name}" already exists`);
      const updated = await this.repository.update(tenantId, id, {
        ...input,
        ...(name ? { name } : {}),
        updatedBy: actorId,
      });
      if (!updated) throw new NotFoundError(`Transporter ${id} not found`);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_UPDATED',
        resourceType: 'transporter',
        oldData: this.snapshot(existing),
        newData: this.snapshot(updated),
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to update transporter');
    }
  }
  async delete(tenantId: string, actorId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Transporter ${id} not found`);
      await this.repository.softDelete(tenantId, id, actorId);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_DELETED',
        resourceType: 'transporter',
        oldData: this.snapshot(existing),
      });
    } catch (error) {
      rethrow(error, 'Failed to delete transporter');
    }
  }
  private snapshot(value: {
    id: string;
    tenantId: string;
    name: string;
    rate: string;
    creditDays: number;
    deletedAt: Date | null;
  }) {
    return {
      id: value.id,
      tenantId: value.tenantId,
      name: value.name,
      rate: value.rate,
      creditDays: value.creditDays,
      deletedAt: value.deletedAt,
    };
  }
}
