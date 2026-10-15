import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../../shared/errors';
import { paginate } from '../../../shared/utils/pagination';
import { toDateString } from '../../../shared/utils/date';
import { AuditService } from '../../audit/audit.service';
import { CodeSequenceRepository } from '../../loads/code-sequence.repository';
import { formatContractCode } from '../../loads/utils/code.util';
import { TransporterService } from '../transporter/transporter.service';
import { TransporterContractEntity } from './entities/transporter-contract.entity';
import {
  CreateTransporterContractInput,
  LaneSummaryQueryInput,
  ListTransporterContractsInput,
  UpdateTransporterContractInput,
} from './transporter-contract.interface';
import { resolveIndianState } from '../../../shared/constants/indian-states';
import { LaneParts, buildLaneKey } from './transporter-contract.lane';
import { TransporterContractRepository } from './transporter-contract.repository';
import { EXPIRING_SOON_DAYS } from './transporter-contract.types';

export type ContractValidity = 'upcoming' | 'active' | 'expiring_soon' | 'expired';

/** Where a contract's validity window sits relative to `today` (all 'YYYY-MM-DD'). */
export function contractValidity(
  contract: Pick<TransporterContractEntity, 'validFrom' | 'validTo'>,
  today: string,
): ContractValidity {
  if (contract.validTo < today) return 'expired';
  if (contract.validFrom > today) return 'upcoming';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + EXPIRING_SOON_DAYS);
  return contract.validTo <= toDateString(soon) ? 'expiring_soon' : 'active';
}

const SHARE_TOLERANCE = 0.005;

export class TransporterContractService {
  constructor(
    private readonly repository: TransporterContractRepository,
    private readonly transporters: TransporterService,
    private readonly codeSequences: CodeSequenceRepository,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateTransporterContractInput) {
    try {
      const transporter = await this.transporters.getTransporter(tenantId, input.transporterId);
      this.assertTransporterActive(transporter.status);
      const validFrom = input.validFrom ?? toDateString(new Date());
      this.assertDates(validFrom, input.validTo);
      const { laneKey, pickupState, dropState } = this.canonicalLane(input);

      const created = await this.dataSource.transaction(async (manager) => {
        const customer = await this.repository.lockCustomer(manager, tenantId, input.customerId);
        if (!customer) throw new NotFoundError(`Customer ${input.customerId} not found`);
        const siblings = await this.repository.findOverlapping(
          tenantId,
          input.customerId,
          laneKey,
          validFrom,
          input.validTo,
          null,
          manager,
        );
        const sharePercent = this.resolveShare(input.sharePercent, siblings);
        this.assertLaneRules(
          { transporterId: input.transporterId, priority: input.priority, sharePercent },
          siblings,
        );
        const code = formatContractCode(
          await this.codeSequences.next('contract', tenantId, manager),
        );
        return this.repository.create(
          {
            tenantId,
            customerId: input.customerId,
            transporterId: input.transporterId,
            contractNumber: code,
            pickupCity: input.pickupCity.trim(),
            pickupState,
            dropCity: input.dropCity.trim(),
            dropState,
            laneKey,
            rate: String(input.rate),
            unit: input.unit,
            validFrom,
            validTo: input.validTo,
            priority: input.priority,
            sharePercent: String(sharePercent),
            createdBy: actorId,
            updatedBy: null,
            deletedAt: null,
          },
          manager,
        );
      });

      const contract = await this.repository.findById(tenantId, created.id);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_CREATED',
        resourceType: 'transporter_contract',
        newData: this.snapshot(contract!),
      });
      return this.present(contract!);
    } catch (error) {
      rethrow(error, 'Failed to create transporter contract');
    }
  }

  async list(tenantId: string, input: ListTransporterContractsInput) {
    try {
      const today = toDateString(new Date());
      const result = await this.repository.list(tenantId, input, today);
      return paginate(
        result.items.map((item) => this.present(item, today)),
        result.total,
        input,
      );
    } catch (error) {
      rethrow(error, 'Failed to list transporter contracts');
    }
  }

  async get(tenantId: string, id: string) {
    try {
      return this.present(await this.getOrThrow(tenantId, id));
    } catch (error) {
      rethrow(error, 'Failed to fetch transporter contract');
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    input: UpdateTransporterContractInput,
  ) {
    try {
      const existing = await this.getOrThrow(tenantId, id);
      if (input.transporterId && input.transporterId !== existing.transporterId) {
        const transporter = await this.transporters.getTransporter(tenantId, input.transporterId);
        this.assertTransporterActive(transporter.status);
      }
      const next = {
        transporterId: input.transporterId ?? existing.transporterId,
        pickupCity: input.pickupCity?.trim() ?? existing.pickupCity,
        pickupState: input.pickupState ?? existing.pickupState,
        dropCity: input.dropCity?.trim() ?? existing.dropCity,
        dropState: input.dropState ?? existing.dropState,
        validFrom: input.validFrom ?? existing.validFrom,
        validTo: input.validTo ?? existing.validTo,
        priority: input.priority ?? existing.priority,
        sharePercent: input.sharePercent ?? Number(existing.sharePercent),
      };
      this.assertDates(next.validFrom, next.validTo);
      const { laneKey, pickupState, dropState } = this.canonicalLane(next);

      await this.dataSource.transaction(async (manager) => {
        await this.repository.lockCustomer(manager, tenantId, existing.customerId);
        const siblings = await this.repository.findOverlapping(
          tenantId,
          existing.customerId,
          laneKey,
          next.validFrom,
          next.validTo,
          id,
          manager,
        );
        this.assertLaneRules(next, siblings);
        await this.repository.update(
          tenantId,
          id,
          {
            transporterId: next.transporterId,
            pickupCity: next.pickupCity,
            pickupState,
            dropCity: next.dropCity,
            dropState,
            laneKey,
            rate: input.rate === undefined ? existing.rate : String(input.rate),
            unit: input.unit ?? existing.unit,
            validFrom: next.validFrom,
            validTo: next.validTo,
            priority: next.priority,
            sharePercent: String(next.sharePercent),
            updatedBy: actorId,
          },
          manager,
        );
      });

      const updated = await this.getOrThrow(tenantId, id);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_UPDATED',
        resourceType: 'transporter_contract',
        oldData: this.snapshot(existing),
        newData: this.snapshot(updated),
      });
      return this.present(updated);
    } catch (error) {
      rethrow(error, 'Failed to update transporter contract');
    }
  }

  async delete(tenantId: string, actorId: string, id: string) {
    try {
      const existing = await this.getOrThrow(tenantId, id);
      await this.repository.softDelete(tenantId, id, actorId);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CONTRACT_DELETED',
        resourceType: 'transporter_contract',
        oldData: this.snapshot(existing),
      });
    } catch (error) {
      rethrow(error, 'Failed to delete transporter contract');
    }
  }

  /** The customer-master view: every contract of the customer, grouped by lane, P1 first. */
  async listForCustomer(tenantId: string, customerId: string) {
    try {
      const today = toDateString(new Date());
      const contracts = await this.repository.listForCustomer(tenantId, customerId);
      const lanes = new Map<string, TransporterContractEntity[]>();
      for (const contract of contracts) {
        const group = lanes.get(contract.laneKey) ?? [];
        group.push(contract);
        lanes.set(contract.laneKey, group);
      }
      return [...lanes.values()].map((group) => this.presentLane(group, today));
    } catch (error) {
      rethrow(error, 'Failed to list customer contracts');
    }
  }

  /** Priority, share and share total for one lane (contracts that have not expired). */
  async laneSummary(tenantId: string, input: LaneSummaryQueryInput) {
    try {
      const today = toDateString(new Date());
      const laneKey = this.laneKeyOf(input);
      const contracts = await this.repository.listLane(tenantId, input.customerId, laneKey, today);
      return {
        laneKey,
        pickupCity: input.pickupCity,
        pickupState: input.pickupState,
        dropCity: input.dropCity,
        dropState: input.dropState,
        ...this.shareTotals(contracts, today),
        contracts: contracts.map((contract) => this.present(contract, today)),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch lane summary');
    }
  }

  /**
   * Every contract of the customer as an Indent option, selectable ones first and by priority
   * (P1 first). Selectable = valid today, on the posted lane (when one is given) and with an
   * active transporter; the rest are kept so the screen can show them disabled with a reason.
   */
  async indentOptions(tenantId: string, customerId: string, lane: LaneParts | null) {
    const today = toDateString(new Date());
    const laneKey = lane ? buildLaneKey(lane) : null;
    const contracts = await this.repository.listForCustomer(tenantId, customerId);
    const options = contracts.map((contract) => {
      const valid = contract.validFrom <= today && contract.validTo >= today;
      const onLane = lane === null || (laneKey !== null && contract.laneKey === laneKey);
      const stateKnown = contract.laneKey !== '';
      const active = contract.transporter?.status === 'active';
      const reason = !valid
        ? 'expired_or_not_started'
        : !stateKnown
          ? 'lane_state_missing'
          : !onLane
            ? 'no_contract_on_this_lane'
            : !active
              ? 'transporter_inactive'
              : null;
      return { contract, selectable: reason === null, reason };
    });
    return options.sort(
      (a, b) =>
        Number(b.selectable) - Number(a.selectable) ||
        a.contract.priority - b.contract.priority ||
        b.contract.validTo.localeCompare(a.contract.validTo),
    );
  }

  private async getOrThrow(tenantId: string, id: string) {
    const contract = await this.repository.findById(tenantId, id);
    if (!contract) throw new NotFoundError(`Transporter contract ${id} not found`);
    return contract;
  }

  /** The lane key plus the canonical state names to store (a caller may pass "MH"). */
  private canonicalLane(lane: LaneParts) {
    const laneKey = this.laneKeyOf(lane);
    return {
      laneKey,
      pickupState: resolveIndianState(lane.pickupState)!,
      dropState: resolveIndianState(lane.dropState)!,
    };
  }

  private laneKeyOf(lane: {
    pickupCity: string;
    pickupState: string;
    dropCity: string;
    dropState: string;
  }): string {
    const key = buildLaneKey(lane);
    if (!key) throw new ValidationError('Pickup and drop must each have a valid Indian state');
    return key;
  }

  private assertTransporterActive(status: string) {
    if (status !== 'active') throw new ConflictError('This transporter is not active');
  }

  private assertDates(validFrom: string, validTo: string) {
    if (validTo < validFrom)
      throw new ValidationError('Contract expiry date must not be before its start date');
  }

  /** No share given: 100% when the lane is otherwise empty, else the caller must split it. */
  private resolveShare(given: number | undefined, siblings: TransporterContractEntity[]) {
    if (given !== undefined) return given;
    if (!siblings.length) return 100;
    throw new ValidationError(
      'Share of business is required when the lane already has another transporter',
    );
  }

  /** Priority and transporter are unique, and shares total at most 100, among the contracts of
   *  the lane whose validity overlaps this one. */
  private assertLaneRules(
    next: { transporterId: string; priority: number; sharePercent: number },
    siblings: TransporterContractEntity[],
  ) {
    const samePriority = siblings.find((sibling) => sibling.priority === next.priority);
    if (samePriority) {
      throw new ConflictError(
        `P${next.priority} is already taken on this lane by ${
          samePriority.transporter?.name ?? 'another transporter'
        } for an overlapping period`,
      );
    }
    if (siblings.some((sibling) => sibling.transporterId === next.transporterId)) {
      throw new ConflictError(
        'This transporter already has a contract on this lane for an overlapping period',
      );
    }
    const total =
      siblings.reduce((sum, sibling) => sum + Number(sibling.sharePercent), 0) + next.sharePercent;
    if (total > 100 + SHARE_TOLERANCE) {
      throw new ValidationError(
        `Share of business on this lane would total ${Number(total.toFixed(2))}% (maximum 100%)`,
      );
    }
  }

  private shareTotals(contracts: TransporterContractEntity[], today: string) {
    const current = contracts.filter((contract) => contract.validFrom <= today);
    const totalSharePercent = Number(
      current.reduce((sum, contract) => sum + Number(contract.sharePercent), 0).toFixed(2),
    );
    return {
      totalSharePercent,
      shareComplete: Math.abs(totalSharePercent - 100) <= SHARE_TOLERANCE,
    };
  }

  private presentLane(group: TransporterContractEntity[], today: string) {
    const [first] = group;
    return {
      laneKey: first.laneKey,
      pickupCity: first.pickupCity,
      pickupState: first.pickupState,
      dropCity: first.dropCity,
      dropState: first.dropState,
      ...this.shareTotals(
        group.filter((contract) => contract.validTo >= today),
        today,
      ),
      contracts: group.map((contract) => this.present(contract, today)),
    };
  }

  private present(contract: TransporterContractEntity, today = toDateString(new Date())) {
    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      customerName: contract.customer?.name ?? null,
      transporterId: contract.transporterId,
      transporterName: contract.transporter?.name ?? null,
      pickupCity: contract.pickupCity,
      pickupState: contract.pickupState,
      dropCity: contract.dropCity,
      dropState: contract.dropState,
      rate: contract.rate,
      unit: contract.unit,
      validFrom: contract.validFrom,
      validTo: contract.validTo,
      priority: contract.priority,
      sharePercent: contract.sharePercent,
      status: contractValidity(contract, today),
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }

  private snapshot(contract: TransporterContractEntity) {
    return {
      id: contract.id,
      tenantId: contract.tenantId,
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      transporterId: contract.transporterId,
      pickupCity: contract.pickupCity,
      pickupState: contract.pickupState,
      dropCity: contract.dropCity,
      dropState: contract.dropState,
      rate: contract.rate,
      unit: contract.unit,
      validFrom: contract.validFrom,
      validTo: contract.validTo,
      priority: contract.priority,
      sharePercent: contract.sharePercent,
      deletedAt: contract.deletedAt,
    };
  }
}
