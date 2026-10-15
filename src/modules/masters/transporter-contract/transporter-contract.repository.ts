import { DataSource, EntityManager, IsNull, LessThanOrEqual, MoreThanOrEqual, Not } from 'typeorm';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { toDateString } from '../../../shared/utils/date';
import { TransporterContractEntity } from './entities/transporter-contract.entity';
import { ListTransporterContractsInput } from './transporter-contract.interface';
import { EXPIRING_SOON_DAYS } from './transporter-contract.types';

type ContractData = Omit<
  TransporterContractEntity,
  'id' | 'createdAt' | 'updatedAt' | 'customer' | 'transporter'
>;

const RELATIONS = { transporter: true, customer: true } as const;

export class TransporterContractRepository {
  constructor(private readonly dataSource: DataSource) {}

  private contracts(manager?: EntityManager) {
    return (manager ?? this.dataSource.manager).getRepository(TransporterContractEntity);
  }

  create(data: ContractData, manager?: EntityManager) {
    const repo = this.contracts(manager);
    return repo.save(repo.create(data));
  }

  findById(tenantId: string, id: string, manager?: EntityManager) {
    return this.contracts(manager).findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: RELATIONS,
    });
  }

  /** Row-locks the customer for the transaction so two writers on the same customer's lanes
   *  serialize — the priority/share checks read-then-write and would otherwise race. */
  lockCustomer(manager: EntityManager, tenantId: string, customerId: string) {
    return manager.getRepository(CustomerEntity).findOne({
      where: { id: customerId, tenantId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findCustomerByCode(tenantId: string, code: string) {
    return this.dataSource.getRepository(CustomerEntity).findOneBy({
      tenantId,
      code: code.trim().toUpperCase(),
      deletedAt: IsNull(),
    });
  }

  /** Contracts of the same customer and lane whose validity window overlaps [from, to]. */
  findOverlapping(
    tenantId: string,
    customerId: string,
    laneKey: string,
    validFrom: string,
    validTo: string,
    excludeId: string | null,
    manager?: EntityManager,
  ) {
    return this.contracts(manager).find({
      where: {
        tenantId,
        customerId,
        laneKey,
        deletedAt: IsNull(),
        validFrom: LessThanOrEqual(validTo),
        validTo: MoreThanOrEqual(validFrom),
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
      relations: { transporter: true },
      order: { priority: 'ASC' },
    });
  }

  /** Every non-deleted contract of one lane that has not expired, P1 first. */
  listLane(tenantId: string, customerId: string, laneKey: string, today: string) {
    return this.contracts().find({
      where: {
        tenantId,
        customerId,
        laneKey,
        deletedAt: IsNull(),
        validTo: MoreThanOrEqual(today),
      },
      relations: { transporter: true },
      order: { priority: 'ASC' },
    });
  }

  /** Every non-deleted contract of the customer, grouped by callers on lane. */
  listForCustomer(tenantId: string, customerId: string) {
    return this.contracts().find({
      where: { tenantId, customerId, deletedAt: IsNull() },
      relations: { transporter: true },
      order: { laneKey: 'ASC', priority: 'ASC' },
    });
  }

  async list(tenantId: string, input: ListTransporterContractsInput, today: string) {
    const qb = this.contracts()
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.transporter', 'transporter')
      .leftJoinAndSelect('contract.customer', 'customer')
      .where('contract.tenantId = :tenantId', { tenantId })
      .andWhere('contract.deletedAt IS NULL');

    if (input.customerId) qb.andWhere('contract.customerId = :customerId', input);
    if (input.transporterId) qb.andWhere('contract.transporterId = :transporterId', input);
    if (input.pickupCity)
      qb.andWhere('contract.pickupCity ILIKE :pickupCity', {
        pickupCity: `%${escapeLike(input.pickupCity)}%`,
      });
    if (input.dropCity)
      qb.andWhere('contract.dropCity ILIKE :dropCity', {
        dropCity: `%${escapeLike(input.dropCity)}%`,
      });
    if (input.search) {
      qb.andWhere(
        '(contract.contractNumber ILIKE :search OR transporter.name ILIKE :search OR customer.name ILIKE :search)',
        { search: `%${escapeLike(input.search)}%` },
      );
    }

    switch (input.status) {
      case 'active':
        qb.andWhere('contract.validFrom <= :today AND contract.validTo >= :today', { today });
        break;
      case 'expired':
        qb.andWhere('contract.validTo < :today', { today });
        break;
      case 'upcoming':
        qb.andWhere('contract.validFrom > :today', { today });
        break;
      case 'expiring_soon': {
        const soon = new Date(`${today}T00:00:00Z`);
        soon.setUTCDate(soon.getUTCDate() + EXPIRING_SOON_DAYS);
        qb.andWhere(
          'contract.validFrom <= :today AND contract.validTo >= :today AND contract.validTo <= :soon',
          { today, soon: toDateString(soon) },
        );
        break;
      }
      default:
        break;
    }

    const [items, total] = await qb
      .orderBy('contract.createdAt', 'DESC')
      .skip((input.page - 1) * input.limit)
      .take(input.limit)
      .getManyAndCount();
    return { items, total };
  }

  async update(tenantId: string, id: string, data: Partial<ContractData>, manager?: EntityManager) {
    await this.contracts(manager).update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id, manager);
  }

  softDelete(tenantId: string, id: string, updatedBy: string) {
    return this.contracts().update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy },
    );
  }
}

/** Escapes LIKE wildcards so user text matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
