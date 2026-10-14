import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { LoadPostingRepository } from './load-posting.repository';
import { ContractsQueryInput, CreateContractInput } from './utils/load-posting.interface';

/** A customer's transporter contracts — the Indent option list (PL-21) and where they get entered. */
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
   * Every contract of the customer with `selectable` set: valid today and, when a lane is given,
   * on that lane. Non-matching ones are returned disabled, not hidden (PL-21 note 1). Loadsmart is
   * never an option here — it is not in the Transporter master.
   */
  async list(tenantId: string, input: ContractsQueryInput) {
    try {
      const contracts = await this.repository.listContracts(tenantId, input.customerId);
      const today = new Date().toISOString().slice(0, 10);
      const lower = (value?: string) => (value ?? '').trim().toLowerCase();
      return contracts.map((contract) => {
        const valid = contract.validFrom <= today && contract.validTo >= today;
        const onLane =
          (!input.pickupCity || lower(contract.pickupCity) === lower(input.pickupCity)) &&
          (!input.dropCity || lower(contract.dropCity) === lower(input.dropCity));
        return {
          id: contract.id,
          contractNumber: contract.contractNumber,
          transporterId: contract.transporterId,
          transporterName: contract.transporter?.name ?? null,
          pickupCity: contract.pickupCity,
          dropCity: contract.dropCity,
          rate: contract.rate,
          validFrom: contract.validFrom,
          validTo: contract.validTo,
          selectable: valid && onLane && contract.transporter?.status === 'active',
          reason: !valid ? 'expired_or_not_started' : !onLane ? 'no_contract_on_this_lane' : null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to list contracts');
    }
  }
}
