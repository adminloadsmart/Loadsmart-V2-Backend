import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../../shared/utils/pagination';
import { TransporterEntity } from './entities/transporter.entity';
import { TransporterRepository } from './transporter.repository';
import {
  CreateTransporterInput,
  ListTransportersInput,
  UpdateTransporterInput,
} from './transporter.interface';

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
      if (await this.repository.findByPhone(tenantId, input.phone))
        throw new ConflictError(`A transporter with phone "${input.phone}" already exists`);
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
  async get(tenantId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      const transporter = await this.repository.findById(tenantId, id);
      if (!transporter) throw new NotFoundError(`Transporter ${id} not found`);
      return transporter;
    } catch (error) {
      rethrow(error, 'Failed to fetch transporter');
    }
  }

  async getTransporter(tenantId: string, id: string) {
    try {
      const transporter = await this.repository.findById(tenantId, id);
      if (!transporter) throw new NotFoundError(`Transporter ${id} not found`);
      return transporter;
    } catch (error) {
      rethrow(error, 'Failed to fetch transporter');
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
      if (
        input.phone &&
        input.phone !== existing.phone &&
        (await this.repository.findByPhone(tenantId, input.phone))
      )
        throw new ConflictError(`A transporter with phone "${input.phone}" already exists`);
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
  private snapshot(value: TransporterEntity) {
    return {
      id: value.id,
      tenantId: value.tenantId,
      name: value.name,
      phone: value.phone,
      rate: value.rate,
      email: value.email,
      gstin: value.gstin,
      msmeRegistration: value.msmeRegistration,
      companyType: value.companyType,
      status: value.status,
      advancePercentage: value.advancePercentage,
      creditDays: value.creditDays,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      landmark: value.landmark,
      areaLocality: value.areaLocality,
      city: value.city,
      state: value.state,
      pinCode: value.pinCode,
      bankAccountNumber: value.bankAccountNumber,
      bankIfsc: value.bankIfsc,
      bankAccountHolderName: value.bankAccountHolderName,
      deletedAt: value.deletedAt,
    };
  }
}
