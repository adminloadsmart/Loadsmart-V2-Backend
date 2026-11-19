import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { toIstDateString } from '../../../shared/utils/ist-time';
import { LoadPostingRepository } from './load-posting.repository';
import { ContractsQueryInput, CreateContractInput } from './utils/load-posting.interface';

/** The Indent option list (PL-21), read from Settings → Masters → Contracts. `create` is the legacy
 *  loads.customer_contracts entry point, no longer read by Indent. */
export class CustomerContractService {
  constructor(
    private readonly repository: LoadPostingRepository,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateContractInput) {
    try {
      const [customer] = await this.repository.findCustomers(tenantId, [input.customerId]);
      if (!customer) throw new NotFoundError(`Customer ${input.customerId} not found`);
      const [transporter] = await this.repository.findActiveTransporters(tenantId, [
        input.transporterId,
      ]);
      if (!transporter) throw new NotFoundError(`Transporter ${input.transporterId} not found`);
      if (await this.repository.findContractByNumber(tenantId, input.contractNumber)) {
        throw new ConflictError(`Contract "${input.contractNumber}" already exists`);
      }
      const contract = await this.repository.createContract({
        tenantId,
        customerId: input.customerId,
        transporterId: input.transporterId,
        contractNumber: input.contractNumber,
        pickupCity: input.pickupCity,
        dropCity: input.dropCity,
        rate: String(input.rate),
        nonPlacementPenalty:
          input.nonPlacementPenalty === undefined ? null : String(input.nonPlacementPenalty),
        validFrom: input.validFrom,
        validTo: input.validTo,
        createdBy: actorId,
        deletedAt: null,
      });
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'CUSTOMER_CONTRACT_CREATED',
        resourceType: 'customer',
        newData: {
          id: contract.id,
          customerId: input.customerId,
          contractNumber: input.contractNumber,
        },
      });
      return contract;
    } catch (error) {
      rethrow(error, 'Failed to create contract');
    }
  }

  /**
   * Indent picker (PL-21): the transporters with a Settings → Masters → Contracts contract on the
   * load's lane corridor — source city + state to destination city + state. Each comes with
   * `selectable` (valid today and the transporter is active); the rest are returned disabled with a
   * `reason`, not hidden (PL-21 note 1). Loadsmart is never an option — it is not in the
   * Transporter master.
   */
  async list(tenantId: string, input: ContractsQueryInput) {
    try {
      const contracts = await this.repository.findMasterContractsOnLane(tenantId, {
        sourceCity: input.pickupCity,
        sourceState: input.pickupState,
        destinationCity: input.dropCity,
        destinationState: input.dropState,
      });
      const today = toIstDateString(new Date());
      return contracts.map((contract) => {
        const valid = contract.validFrom <= today && contract.validTo >= today;
        const active = contract.transporter?.status === 'active';
        return {
          id: contract.id,
          contractNumber: null,
          transporterId: contract.transporterId,
          transporterName: contract.transporter?.name ?? null,
          transporterCode: contract.transporter?.code ?? null,
          pickupCity: contract.sourceCity,
          pickupState: contract.sourceState,
          dropCity: contract.destinationCity,
          dropState: contract.destinationState,
          rate: contract.agreedRate,
          billingUnit: contract.billingUnit,
          priority: contract.priority,
          sharePercentage: contract.sharePercentage,
          validFrom: contract.validFrom,
          validTo: contract.validTo,
          selectable: valid && active,
          reason: !valid ? 'expired_or_not_started' : !active ? 'transporter_inactive' : null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to list contracts');
    }
  }
}
