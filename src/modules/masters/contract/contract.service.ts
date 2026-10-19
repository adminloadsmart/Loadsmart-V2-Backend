import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { paginate } from '../../../shared/utils/pagination';
import { toIstDateString } from '../../../shared/utils/ist-time';
import { buildCsv, CSV_EXPORT_MAX_ROWS, CsvColumn } from '../../../shared/utils/csv';
import { AuditService } from '../../audit/audit.service';
import { TransporterService } from '../transporter/transporter.service';
import { MasterRecordSource } from '../transporter/transporter.types';
import { TransporterContractEntity } from './entities/transporter-contract.entity';
import { ContractRepository } from './contract.repository';
import { CONTRACT_EXPIRING_WINDOW_DAYS, ContractDisplayStatus } from './contract.types';
import {
  ContractLane,
  CreateContractInput,
  LaneAllocationInput,
  ListContractsInput,
  UpdateContractInput,
} from './contract.interface';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today (IST) to an ISO date; negative once it's past. */
function daysUntil(isoDate: string): number {
  const today = Date.parse(`${toIstDateString(new Date())}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / DAY_MS);
}

/** Never stored — derived from validity so it can't go stale ("Active" / "Expiring" badge). */
export function contractDisplayStatus(contract: {
  validFrom: string;
  validTo: string;
}): ContractDisplayStatus {
  if (daysUntil(contract.validFrom) > 0) return 'upcoming';
  const daysToExpiry = daysUntil(contract.validTo);
  if (daysToExpiry < 0) return 'expired';
  return daysToExpiry <= CONTRACT_EXPIRING_WINDOW_DAYS ? 'expiring' : 'active';
}

export function toContractView(contract: TransporterContractEntity) {
  const { transporter, ...rest } = contract;
  const recordSource: MasterRecordSource =
    transporter?.gstVerificationStatus === 'verified' ? 'shared_master' : 'own_record';
  return {
    ...rest,
    transporter: transporter
      ? {
          id: transporter.id,
          name: transporter.name,
          code: transporter.code,
          gstin: transporter.gstin,
          status: transporter.status,
          gstVerificationStatus: transporter.gstVerificationStatus,
          recordSource,
        }
      : null,
    status: contractDisplayStatus(contract),
    daysToExpiry: daysUntil(contract.validTo),
  };
}

type ContractView = ReturnType<typeof toContractView>;

/** Headers match the bulk-upload columns so an export can be edited and uploaded back. */
const CONTRACT_EXPORT_COLUMNS: CsvColumn<ContractView>[] = [
  { header: 'transporterCode', value: (c) => c.transporter?.code },
  { header: 'transporterName', value: (c) => c.transporter?.name },
  { header: 'transporterGstin', value: (c) => c.transporter?.gstin },
  { header: 'sourceCity', value: (c) => c.sourceCity },
  { header: 'sourceState', value: (c) => c.sourceState },
  { header: 'destinationCity', value: (c) => c.destinationCity },
  { header: 'destinationState', value: (c) => c.destinationState },
  { header: 'agreedRate', value: (c) => c.agreedRate },
  { header: 'billingUnit', value: (c) => c.billingUnit },
  { header: 'validFrom', value: (c) => c.validFrom },
  { header: 'validTo', value: (c) => c.validTo },
  { header: 'priority', value: (c) => c.priority },
  { header: 'sharePercentage', value: (c) => c.sharePercentage },
  { header: 'notes', value: (c) => c.notes },
  { header: 'status', value: (c) => c.status },
];

const laneOf = (value: ContractLane): ContractLane => ({
  sourceCity: value.sourceCity,
  sourceState: value.sourceState,
  destinationCity: value.destinationCity,
  destinationState: value.destinationState,
});

/**
 * Settings → Masters → Contracts. A transporter's agreed rate and P-ranking on one lane, with a
 * share of business. Rules across contracts on the same lane with overlapping validity: one per
 * transporter, unique priority, and shares summing to at most 100% ("100% Target").
 */
export class ContractService {
  constructor(
    private readonly repository: ContractRepository,
    private readonly transporterService: TransporterService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(role: string) {
    if (role !== ORG_ADMIN_ROLE)
      throw new AuthorizationError('Only organization admins can manage contracts');
  }

  private async assertTransporterUsable(tenantId: string, transporterId: string) {
    const transporter = await this.transporterService.getTransporter(tenantId, transporterId);
    if (transporter.status !== 'active')
      throw new ConflictError(`Transporter ${transporter.name} is not active`);
  }

  /** Cross-contract lane rules — see the class comment. */
  private async assertLaneRules(
    tenantId: string,
    candidate: CreateContractInput,
    excludeId?: string,
  ) {
    const overlapping = await this.repository.findOverlapping(
      tenantId,
      laneOf(candidate),
      candidate.validFrom,
      candidate.validTo,
      excludeId,
    );
    const sameTransporter = overlapping.find((c) => c.transporterId === candidate.transporterId);
    if (sameTransporter)
      throw new ConflictError(
        'This transporter already has a contract on this lane for an overlapping period',
        { contractId: sameTransporter.id },
      );
    const samePriority = overlapping.find((c) => c.priority === candidate.priority);
    if (samePriority)
      throw new ConflictError(
        `P${candidate.priority} on this lane is already held by ${samePriority.transporter?.name ?? 'another transporter'}`,
        { contractId: samePriority.id },
      );
    const allocated = overlapping.reduce((sum, c) => sum + Number(c.sharePercentage ?? 0), 0);
    if (allocated + Number(candidate.sharePercentage ?? 0) > 100)
      throw new ConflictError(
        `Share of business on this lane would exceed 100% — ${allocated}% is already allocated`,
        {
          allocatedSharePercentage: allocated,
          remainingSharePercentage: Math.max(0, 100 - allocated),
        },
      );
  }

  async create(tenantId: string, actorId: string, role: string, input: CreateContractInput) {
    try {
      this.assertAdmin(role);
      await this.assertTransporterUsable(tenantId, input.transporterId);
      await this.assertLaneRules(tenantId, input);
      const created = await this.repository.create({
        tenantId,
        transporterId: input.transporterId,
        ...laneOf(input),
        agreedRate: String(input.agreedRate),
        billingUnit: input.billingUnit,
        validFrom: input.validFrom,
        validTo: input.validTo,
        priority: input.priority,
        sharePercentage: input.sharePercentage == null ? null : String(input.sharePercentage),
        notes: input.notes ?? null,
        createdBy: actorId,
        updatedBy: null,
      });
      const contract = await this.repository.findById(tenantId, created.id);
      if (!contract) throw new NotFoundError('Contract was not created');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_CREATED',
        resourceType: 'transporter_contract',
        newData: this.snapshot(contract),
      });
      return toContractView(contract);
    } catch (error) {
      rethrow(error, 'Failed to create contract');
    }
  }

  async list(tenantId: string, input: ListContractsInput) {
    try {
      const [items, total] = await this.repository.list(tenantId, input);
      return paginate(items.map(toContractView), total, input);
    } catch (error) {
      rethrow(error, 'Failed to list contracts');
    }
  }

  async export(tenantId: string, filters: Omit<ListContractsInput, 'page' | 'limit'>) {
    try {
      const items = await this.repository.listForExport(tenantId, filters, CSV_EXPORT_MAX_ROWS);
      return buildCsv(CONTRACT_EXPORT_COLUMNS, items.map(toContractView));
    } catch (error) {
      rethrow(error, 'Failed to export contracts');
    }
  }

  async get(tenantId: string, id: string) {
    try {
      const contract = await this.repository.findById(tenantId, id);
      if (!contract) throw new NotFoundError(`Contract ${id} not found`);
      return toContractView(contract);
    } catch (error) {
      rethrow(error, 'Failed to fetch contract');
    }
  }

  /** "Lane allocation (Mohali → Bhiwandi) · Existing carriers currently active on this lane: 2". */
  async laneAllocation(tenantId: string, input: LaneAllocationInput) {
    try {
      const contracts = await this.repository.findActiveOnLane(
        tenantId,
        laneOf(input),
        input.excludeContractId,
      );
      const allocated = contracts.reduce((sum, c) => sum + Number(c.sharePercentage ?? 0), 0);
      return {
        lane: laneOf(input),
        activeCarrierCount: new Set(contracts.map((c) => c.transporterId)).size,
        allocatedSharePercentage: allocated,
        remainingSharePercentage: Math.max(0, 100 - allocated),
        carriers: contracts.map((c) => ({
          contractId: c.id,
          transporterId: c.transporterId,
          transporterName: c.transporter?.name ?? null,
          transporterCode: c.transporter?.code ?? null,
          priority: c.priority,
          sharePercentage: c.sharePercentage,
          validTo: c.validTo,
        })),
      };
    } catch (error) {
      rethrow(error, 'Failed to compute lane allocation');
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    input: UpdateContractInput,
  ) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Contract ${id} not found`);
      const merged: CreateContractInput = {
        transporterId: input.transporterId ?? existing.transporterId,
        sourceCity: input.sourceCity ?? existing.sourceCity,
        sourceState: input.sourceState ?? existing.sourceState,
        destinationCity: input.destinationCity ?? existing.destinationCity,
        destinationState: input.destinationState ?? existing.destinationState,
        agreedRate: input.agreedRate ?? Number(existing.agreedRate),
        billingUnit: input.billingUnit ?? existing.billingUnit,
        validFrom: input.validFrom ?? existing.validFrom,
        validTo: input.validTo ?? existing.validTo,
        priority: input.priority ?? existing.priority,
        sharePercentage:
          input.sharePercentage === undefined
            ? existing.sharePercentage == null
              ? null
              : Number(existing.sharePercentage)
            : input.sharePercentage,
        notes: input.notes === undefined ? existing.notes : input.notes,
      };
      if (merged.validTo < merged.validFrom)
        throw new ConflictError('Expiry date must not be before the valid-from date');
      if (input.transporterId && input.transporterId !== existing.transporterId)
        await this.assertTransporterUsable(tenantId, input.transporterId);
      await this.assertLaneRules(tenantId, merged, id);
      const updated = await this.repository.update(tenantId, id, {
        transporterId: merged.transporterId,
        ...laneOf(merged),
        agreedRate: String(merged.agreedRate),
        billingUnit: merged.billingUnit,
        validFrom: merged.validFrom,
        validTo: merged.validTo,
        priority: merged.priority,
        sharePercentage: merged.sharePercentage == null ? null : String(merged.sharePercentage),
        notes: merged.notes ?? null,
        updatedBy: actorId,
      });
      if (!updated) throw new NotFoundError(`Contract ${id} not found`);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_UPDATED',
        resourceType: 'transporter_contract',
        oldData: this.snapshot(existing),
        newData: this.snapshot(updated),
      });
      return toContractView(updated);
    } catch (error) {
      rethrow(error, 'Failed to update contract');
    }
  }

  /** "Delete contract — remove this agreed rate and priority from active indenting". */
  async delete(tenantId: string, actorId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Contract ${id} not found`);
      await this.repository.softDelete(tenantId, id, actorId);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_DELETED',
        resourceType: 'transporter_contract',
        oldData: this.snapshot(existing),
      });
    } catch (error) {
      rethrow(error, 'Failed to delete contract');
    }
  }

  count(tenantId: string) {
    return this.repository.count(tenantId);
  }

  private snapshot(contract: TransporterContractEntity) {
    return {
      id: contract.id,
      transporterId: contract.transporterId,
      sourceCity: contract.sourceCity,
      sourceState: contract.sourceState,
      destinationCity: contract.destinationCity,
      destinationState: contract.destinationState,
      agreedRate: contract.agreedRate,
      billingUnit: contract.billingUnit,
      validFrom: contract.validFrom,
      validTo: contract.validTo,
      priority: contract.priority,
      sharePercentage: contract.sharePercentage,
    };
  }
}
