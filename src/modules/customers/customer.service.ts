import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { ORG_ADMIN_ROLE, SALES_ROLE, ORG_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import { paginate } from '../admin/utils/admin.types';
import { CustomerColumns, CustomerRepository, CustomerWithCreator } from './customer.repository';
import { MasterApprovalNotifier } from '../notifications/notifications.interface';
import { CodeSequenceRepository } from '../loads/code-sequence.repository';
import { formatCustomerCode } from '../loads/utils/code.util';
import { GstVerificationService, gstNameMatches } from '../masters/gst/gst.service';
import { GstVerificationEntity } from '../masters/gst/entities/gst-verification.entity';
import { MasterUsageRepository } from '../masters/masters.usage';
import { gstStateName } from '../../shared/constants/gst-state-codes';
import { buildCsv, CSV_EXPORT_MAX_ROWS, CsvColumn } from '../../shared/utils/csv';
import {
  CreateCustomerInput,
  CustomerContactInput,
  ListCustomersInput,
  UpdateCustomerInput,
} from './customer.types';

// Anyone invited into the org (sales_cs/dispatch/documents_ops/finance_accounts) can request a
// new customer, same as SALES_ROLE; only org_admin's request auto-approves.
const CUSTOMER_CREATOR_ROLES = [ORG_ADMIN_ROLE, SALES_ROLE, ...ORG_ASSIGNABLE_ROLES];

/**
 * The customer as Settings → Customers reads it: every entity column (so existing consumers keep
 * working) plus the list/drawer's derived fields. `balanceDue` (overdue / due-in days) stays null
 * until invoicing exists — see the settings redesign plan.
 */
export function toCustomerView(customer: CustomerWithCreator) {
  const { createdByUser, ...rest } = customer;
  const firstPoint = customer.deliveryPoints?.[0];
  return {
    ...rest,
    createdByUser: createdByUser
      ? { id: createdByUser.id, fullName: createdByUser.fullName }
      : null,
    registeredCity: customer.registeredCity ?? firstPoint?.city ?? null,
    deliveryPointCount: customer.deliveryPoints?.length ?? 0,
    balanceDue: null as { status: 'overdue' | 'due' | 'paid_on_time'; days: number } | null,
  };
}

/** Old single-contact fields → a contacts[] entry, for callers that don't send contacts yet. */
function legacyContacts(input: CreateCustomerInput): CustomerContactInput[] {
  const phone = input.contactPersonNumber ?? input.mobile;
  if (!phone && !input.contactPersonName && !input.contactPersonEmail) return [];
  return [
    {
      fullName: input.contactPersonName ?? null,
      designation: input.contactPersonDesignation ?? null,
      phone: phone ?? null,
      email: input.contactPersonEmail ?? input.email ?? null,
    },
  ];
}

/** The first contact is mirrored onto the legacy contact_person_* columns, which Post a load and
 *  older screens still read. */
function primaryContactColumns(contacts: CustomerContactInput[]): CustomerColumns {
  const primary = contacts[0];
  return {
    contactPersonName: primary?.fullName ?? null,
    contactPersonNumber: primary?.phone ?? null,
    contactPersonEmail: primary?.email ?? null,
    contactPersonDesignation: primary?.designation ?? null,
  };
}

/** GST bookkeeping columns for a verified register lookup — shared by the save path (a lookup
 *  attached from the Verify button) and the bulk-import 'gst-verification' worker. */
export function verifiedGstColumns(
  verified: GstVerificationEntity,
  gstin: string,
  name: string,
): CustomerColumns {
  return {
    gstVerificationStatus: 'verified',
    gstVerificationId: verified.id,
    gstVerifiedAt: verified.createdAt,
    gstRegistryName: verified.legalName,
    gstNameMatched: gstNameMatches(name, verified),
    gstVerificationError: null,
    placeOfSupply: verified.addressParts?.state || gstStateName(gstin),
    registeredCity: verified.addressParts?.city || null,
  };
}

const CUSTOMER_EXPORT_COLUMNS: CsvColumn<ReturnType<typeof toCustomerView>>[] = [
  { header: 'Code', value: (c) => c.code },
  { header: 'Name', value: (c) => c.name },
  { header: 'GSTIN', value: (c) => c.gstin },
  { header: 'GST Verification', value: (c) => c.gstVerificationStatus },
  { header: 'Place of Supply', value: (c) => c.placeOfSupply },
  { header: 'Registered Address', value: (c) => c.registeredAddress },
  { header: 'Contact Name', value: (c) => c.contacts?.[0]?.fullName },
  { header: 'Contact Designation', value: (c) => c.contacts?.[0]?.designation },
  { header: 'Contact Phone', value: (c) => c.contacts?.[0]?.phone },
  { header: 'Contact Email', value: (c) => c.contacts?.[0]?.email },
  {
    header: 'Delivery Points',
    value: (c) => (c.deliveryPoints ?? []).map((point) => point.location).join(' | '),
  },
  { header: 'Invoice Against', value: (c) => c.invoiceAgainst },
  { header: 'Credit Days', value: (c) => c.creditDays },
  { header: 'Credit Limit', value: (c) => c.creditLimit },
  { header: 'Balance Amount', value: (c) => c.balanceAmount },
  { header: 'Free Hours At Drop', value: (c) => c.freeHoursAtDrop },
  { header: 'Status', value: (c) => c.status },
  { header: 'Created By', value: (c) => c.createdByUser?.fullName },
  { header: 'Created At', value: (c) => c.createdAt?.toISOString().slice(0, 10) },
];

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly dataSource: import('typeorm').DataSource,
    private readonly audit: AuditService,
    private readonly codeSequences: CodeSequenceRepository,
    private readonly gstVerification: GstVerificationService,
    private readonly usage: MasterUsageRepository,
    // LS_N_0009/0010 — optional; only queues a notification after the existing logic and never
    // throws (see notifications/master-approvals.ts).
    private readonly approvalNotifier?: MasterApprovalNotifier,
  ) {}
  private assertRole(role: string, allowed: string[]) {
    if (!allowed.includes(role)) throw new AuthorizationError('Not authorized to manage customers');
  }

  /** GST bookkeeping columns for a GSTIN + optional verification id. Verified only when backed by
   *  a verified lookup row (GstVerificationService.resolveVerified); otherwise a manual entry. */
  private async gstColumns(
    tenantId: string,
    gstin: string | null | undefined,
    verificationId: string | null | undefined,
    name: string,
  ): Promise<CustomerColumns> {
    const verified = await this.gstVerification.resolveVerified(tenantId, gstin, verificationId);
    if (!verified) {
      return {
        gstVerificationStatus: 'unverified',
        gstVerificationId: null,
        gstVerifiedAt: null,
        gstRegistryName: null,
        gstNameMatched: null,
        gstVerificationError: null,
        placeOfSupply: gstStateName(gstin),
      };
    }
    return verifiedGstColumns(verified, gstin!, name);
  }

  private async assertGstinFree(tenantId: string, gstin: string | null | undefined, id?: string) {
    if (gstin && (await this.repository.findByGstin(tenantId, gstin, id)))
      throw new ConflictError(`A customer with GSTIN "${gstin}" already exists`);
  }

  private async assertNotInUse(tenantId: string, id: string, action: string) {
    const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'customer', id });
    if (activeLoads.length)
      throw new ConflictError(
        `Customer is in use right now — ${activeLoads[0].code} is still running, so it cannot be ${action}`,
        { activeLoads },
      );
  }

  async create(
    tenantId: string,
    actorId: string,
    role: string,
    input: CreateCustomerInput,
    source: 'manual' | 'csv_import' = 'manual',
    // Bulk import: an unverified GSTIN is saved as 'pending' — the caller enqueues the
    // 'gst-verification' job (CustomerGstVerificationService.enqueue) once the row exists.
    options: { queueGstVerification?: boolean } = {},
  ) {
    try {
      this.assertRole(role, CUSTOMER_CREATOR_ROLES);
      if (input.mobile && (await this.repository.findByMobile(tenantId, input.mobile)))
        throw new ConflictError(`A customer with mobile "${input.mobile}" already exists`);
      await this.assertGstinFree(tenantId, input.gstin);
      const contacts = input.contacts?.length ? input.contacts : legacyContacts(input);
      const extra: CustomerColumns = {
        ...(input.gstin
          ? await this.gstColumns(tenantId, input.gstin, input.gstVerificationId, input.name)
          : {}),
        ...(input.contacts?.length ? primaryContactColumns(contacts) : {}),
      };
      if (options.queueGstVerification && input.gstin && extra.gstVerificationStatus !== 'verified')
        extra.gstVerificationStatus = 'pending';
      const status = role === ORG_ADMIN_ROLE ? 'active' : 'pending';
      const customer = await this.dataSource.transaction(async (manager) => {
        const code = formatCustomerCode(
          await this.codeSequences.next('customer', tenantId, manager),
        );
        const value = await this.repository.create(
          tenantId,
          actorId,
          status,
          input,
          manager,
          code,
          extra,
        );
        await this.repository.addPoints(value.id, tenantId, input.deliveryPoints ?? [], manager);
        if (contacts.length)
          await this.repository.syncContacts(tenantId, value.id, contacts, manager);
        return this.repository.findById(tenantId, value.id, manager);
      });
      if (!customer) throw new NotFoundError('Customer was not created');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_CREATED',
        resourceType: 'customer',
        newData: {
          id: customer.id,
          status: customer.status,
          name: customer.name,
          gstVerificationStatus: customer.gstVerificationStatus,
          source,
        },
      });
      await this.approvalNotifier?.requested({
        kind: 'customer',
        tenantId,
        recordId: customer.id,
        masterValue: customer.name,
        createdBy: customer.createdBy,
        pending: customer.status === 'pending',
      });
      return toCustomerView(customer);
    } catch (error) {
      rethrow(error, 'Failed to create customer');
    }
  }
  /** Name-only add from Post a load — mobile, GSTIN and contacts are completed later in the
   *  Customer master. Same role gate and approval split as `create`. */
  quickAdd(tenantId: string, actorId: string, role: string, name: string) {
    return this.create(tenantId, actorId, role, { name });
  }
  async list(tenantId: string, role: string, input: ListCustomersInput) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const result = await this.repository.list(tenantId, input);
      return paginate(result.items.map(toCustomerView), result.total, input);
    } catch (error) {
      rethrow(error, 'Failed to list customers');
    }
  }
  async export(
    tenantId: string,
    role: string,
    filters: Omit<ListCustomersInput, 'page' | 'limit'>,
  ): Promise<string> {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const items = await this.repository.listForExport(tenantId, filters, CSV_EXPORT_MAX_ROWS);
      return buildCsv(CUSTOMER_EXPORT_COLUMNS, items.map(toCustomerView));
    } catch (error) {
      rethrow(error, 'Failed to export customers');
    }
  }
  async get(tenantId: string, role: string, id: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const value = await this.repository.findById(tenantId, id);
      if (!value) throw new NotFoundError(`Customer ${id} not found`);
      return toCustomerView(value);
    } catch (error) {
      rethrow(error, 'Failed to fetch customer');
    }
  }

  /** Detail drawer "LOADS" — newest first, with stage label + progress per load. */
  async listLoads(
    tenantId: string,
    role: string,
    id: string,
    pagination: { page: number; limit: number },
  ) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      if (!(await this.repository.findById(tenantId, id)))
        throw new NotFoundError(`Customer ${id} not found`);
      const result = await this.usage.loadHistory(
        tenantId,
        { kind: 'customer', id },
        pagination.page,
        pagination.limit,
      );
      return paginate(result.items, result.total, pagination);
    } catch (error) {
      rethrow(error, 'Failed to list customer loads');
    }
  }

  /** "In use right now. LOAD-1049 is still running." — checked before Make inactive / delete. */
  async usageOf(tenantId: string, role: string, id: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      if (!(await this.repository.findById(tenantId, id)))
        throw new NotFoundError(`Customer ${id} not found`);
      const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'customer', id });
      return { inUse: activeLoads.length > 0, activeLoads };
    } catch (error) {
      rethrow(error, 'Failed to check customer usage');
    }
  }

  /**
   * Open read (no role gate, unlike get() above) — for validating a customerId/deliveryPointId
   * reference from another module before using it, the same "any authenticated org member can
   * read master data, only writes are gated" convention masters/loading-point.service.ts's get()
   * and masters/truck-type.service.ts's assertTruckTypeExists() already follow. Used by
   * loads/requisition.service.ts
   * returns `deliveryPoints` loaded so the caller can
   * validate a delivery point belongs to this customer without a second query.
   */
  async assertActive(tenantId: string, id: string) {
    try {
      const value = await this.repository.findById(tenantId, id);
      if (!value) throw new NotFoundError(`Customer ${id} not found`);
      if (value.status !== 'active') throw new ConflictError(`Customer ${id} is not active`);
      return value;
    } catch (error) {
      rethrow(error, 'Failed to verify customer is active');
    }
  }
  async update(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    input: UpdateCustomerInput,
  ) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      if (
        input.mobile &&
        input.mobile !== existing.mobile &&
        (await this.repository.findByMobile(tenantId, input.mobile))
      )
        throw new ConflictError(`A customer with mobile "${input.mobile}" already exists`);

      const gstin = input.gstin === undefined ? existing.gstin : input.gstin;
      const gstinChanged = input.gstin !== undefined && input.gstin !== existing.gstin;
      if (gstinChanged) await this.assertGstinFree(tenantId, gstin, id);
      const extra: CustomerColumns = {};
      if (input.gstVerificationId || gstinChanged) {
        Object.assign(
          extra,
          await this.gstColumns(
            tenantId,
            gstin,
            input.gstVerificationId,
            input.name ?? existing.name,
          ),
        );
      } else if (input.name && existing.gstVerificationStatus === 'verified') {
        extra.gstNameMatched = gstNameMatches(input.name, {
          legalName: existing.gstRegistryName,
          tradeName: null,
        });
      }
      if (input.contacts) Object.assign(extra, primaryContactColumns(input.contacts));

      // Removing an unloading point a running load still points at would orphan that trip.
      if (input.deliveryPoints !== undefined) {
        const kept = new Set(input.deliveryPoints.map((point) => point.id).filter(Boolean));
        const removed = (await this.repository.livePointIds(tenantId, id)).filter(
          (pointId) => !kept.has(pointId),
        );
        const activeLoads = await this.usage.activeLoads(tenantId, {
          kind: 'delivery_points',
          ids: removed,
        });
        if (activeLoads.length)
          throw new ConflictError(
            `An unloading point you removed is in use — ${activeLoads[0].code} is still running`,
            { activeLoads },
          );
      }

      const updated = await this.dataSource.transaction(async (manager) => {
        const value = await this.repository.update(tenantId, id, actorId, input, manager, extra);
        if (!value) throw new NotFoundError(`Customer ${id} not found`);
        if (input.deliveryPoints !== undefined)
          await this.repository.syncPoints(tenantId, id, input.deliveryPoints, manager);
        if (input.contacts !== undefined)
          await this.repository.syncContacts(tenantId, id, input.contacts, manager);
        return this.repository.findById(tenantId, id, manager);
      });
      if (!updated) throw new NotFoundError(`Customer ${id} not found`);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_UPDATED',
        resourceType: 'customer',
        oldData: {
          id,
          status: existing.status,
          gstVerificationStatus: existing.gstVerificationStatus,
        },
        newData: {
          id,
          fields: Object.keys(input),
          gstVerificationStatus: updated.gstVerificationStatus,
        },
      });
      return toCustomerView(updated);
    } catch (error) {
      rethrow(error, 'Failed to update customer');
    }
  }
  async approve(tenantId: string, actorId: string, role: string, id: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      if (existing.status !== 'pending')
        throw new ConflictError('Only pending customers can be approved');
      const value = await this.repository.approve(tenantId, id, actorId);
      if (!value) throw new ConflictError('Customer approval failed');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_APPROVED',
        resourceType: 'customer',
        oldData: { id, status: 'pending' },
        newData: { id, status: 'active', approvedBy: actorId },
      });
      await this.approvalNotifier?.approved({
        kind: 'customer',
        tenantId,
        recordId: id,
        masterValue: existing.name,
        createdBy: existing.createdBy,
        approvedBy: actorId,
      });
      return toCustomerView(value);
    } catch (error) {
      rethrow(error, 'Failed to approve customer');
    }
  }
  async reject(tenantId: string, actorId: string, role: string, id: string, reason: string) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      if (existing.status !== 'pending')
        throw new ConflictError('Only pending customers can be rejected');
      const value = await this.repository.reject(tenantId, id, actorId, reason);
      if (!value) throw new ConflictError('Customer rejection failed');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_REJECTED',
        resourceType: 'customer',
        oldData: { id, status: 'pending' },
        newData: { id, status: 'rejected', rejectionReason: reason },
      });
      await this.approvalNotifier?.rejected({
        kind: 'customer',
        tenantId,
        recordId: existing.id,
        masterValue: existing.name,
        createdBy: existing.createdBy,
        rejectedBy: actorId,
        reason,
      });
      return toCustomerView(value);
    } catch (error) {
      rethrow(error, 'Failed to reject customer');
    }
  }

  async updateStatus(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    status: 'active' | 'inactive',
  ) {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Customer ${id} not found`);
      if (existing.status !== 'active' && existing.status !== 'inactive')
        throw new ConflictError('Only active or inactive customers can have their status updated');
      if (existing.status === status) throw new ConflictError(`Customer is already ${status}`);
      if (status === 'inactive') await this.assertNotInUse(tenantId, id, 'made inactive');
      const value = await this.repository.updateStatus(tenantId, id, actorId, status);
      if (!value) throw new ConflictError('Customer status update failed');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_STATUS_UPDATED',
        resourceType: 'customer',
        oldData: { id, status: existing.status },
        newData: { id, status },
      });
      return toCustomerView(value);
    } catch (error) {
      rethrow(error, 'Failed to update customer status');
    }
  }

  async delete(tenantId: string, actorId: string, role: string, id: string): Promise<void> {
    try {
      this.assertRole(role, [ORG_ADMIN_ROLE]);
      await this.assertNotInUse(tenantId, id, 'deleted');
      const deleted = await this.dataSource.transaction((manager) =>
        this.repository.softDelete(tenantId, id, actorId, manager),
      );
      if (!deleted) throw new NotFoundError(`Customer ${id} not found`);

      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_DELETED',
        resourceType: 'customer',
        oldData: { id },
      });
    } catch (error) {
      rethrow(error, 'Failed to delete customer');
    }
  }
}
