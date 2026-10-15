import { rethrow } from '../../../shared/errors';
import { TransporterContractService } from '../../masters/transporter-contract/transporter-contract.service';
import { ContractsQueryInput } from './utils/load-posting.interface';

/**
 * The Indent option list (PL-21): a customer's transporter contracts for the posted lane. The
 * contracts themselves are a masters record (masters/transporter-contract/) — this only shapes
 * them for the Post a load screen.
 */
export class CustomerContractService {
  constructor(private readonly contracts: TransporterContractService) {}

  /**
   * Every contract of the customer with `selectable` set: valid today, on the posted lane and with
   * an active transporter. Non-matching ones are returned disabled, not hidden (PL-21 note 1), and
   * the best selectable one (lowest priority number, P1 first) is flagged `suggested`. Loadsmart is
   * never an option here — it is not in the Transporter master.
   */
  async list(tenantId: string, input: ContractsQueryInput) {
    try {
      const lane =
        input.pickupCity && input.pickupState && input.dropCity && input.dropState
          ? {
              pickupCity: input.pickupCity,
              pickupState: input.pickupState,
              dropCity: input.dropCity,
              dropState: input.dropState,
            }
          : null;
      const options = await this.contracts.indentOptions(tenantId, input.customerId, lane);
      const suggestedId = options.find((option) => option.selectable)?.contract.id ?? null;
      return options.map(({ contract, selectable, reason }) => ({
        id: contract.id,
        contractNumber: contract.contractNumber,
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
        selectable,
        suggested: contract.id === suggestedId,
        reason,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list contracts');
    }
  }
}
