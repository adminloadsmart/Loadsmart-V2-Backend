import { Brackets, DataSource, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { TransporterContractEntity } from './entities/transporter-contract.entity';
import { CONTRACT_EXPIRING_WINDOW_DAYS } from './contract.types';
import { ContractLane, ListContractsInput } from './contract.interface';

type ContractColumns = Partial<Omit<TransporterContractEntity, 'transporter'>>;

const SORT_SQL = {
  share: 'c.share_percentage',
  priority: 'c.priority',
  validTo: 'c.valid_to',
  createdAt: 'c.created_at',
  rate: 'c.agreed_rate',
} as const;

// Derived display status as SQL, mirroring contractDisplayStatus() in the service.
const STATUS_SQL = {
  upcoming: 'c.valid_from > CURRENT_DATE',
  expired: 'c.valid_to < CURRENT_DATE',
  expiring: `c.valid_from <= CURRENT_DATE AND c.valid_to >= CURRENT_DATE
    AND c.valid_to <= CURRENT_DATE + ${CONTRACT_EXPIRING_WINDOW_DAYS}`,
  active: `c.valid_from <= CURRENT_DATE
    AND c.valid_to > CURRENT_DATE + ${CONTRACT_EXPIRING_WINDOW_DAYS}`,
} as const;

export class ContractRepository {
  private readonly contracts: Repository<TransporterContractEntity>;
  constructor(dataSource: DataSource) {
    this.contracts = dataSource.getRepository(TransporterContractEntity);
  }

  create(data: ContractColumns): Promise<TransporterContractEntity> {
    return this.contracts.save(this.contracts.create({ ...data, deletedAt: null }));
  }

  private withTransporter() {
    return this.contracts
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.transporter', 'transporter')
      .where('c.deleted_at IS NULL');
  }

  findById(tenantId: string, id: string) {
    return this.withTransporter()
      .andWhere('c.tenant_id = :tenantId AND c.id = :id', { tenantId, id })
      .getOne();
  }

  private filtered(tenantId: string, input: Omit<ListContractsInput, 'page' | 'limit'>) {
    const query = this.withTransporter().andWhere('c.tenant_id = :tenantId', { tenantId });
    if (input.transporterId)
      query.andWhere('c.transporter_id = :transporterId', { transporterId: input.transporterId });
    if (input.status) query.andWhere(`(${STATUS_SQL[input.status]})`);
    if (input.search)
      query.andWhere(
        `(transporter.name ILIKE :search OR transporter.code ILIKE :search
          OR transporter.gstin ILIKE :search OR c.source_city ILIKE :search
          OR c.destination_city ILIKE :search OR c.source_state ILIKE :search
          OR c.destination_state ILIKE :search)`,
        { search: `%${input.search}%` },
      );
    const direction = (input.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';
    return query
      .orderBy(SORT_SQL[input.sortBy ?? 'createdAt'], direction, 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC');
  }

  list(tenantId: string, input: ListContractsInput) {
    return this.filtered(tenantId, input)
      .skip((input.page - 1) * input.limit)
      .take(input.limit)
      .getManyAndCount();
  }

  listForExport(tenantId: string, input: Omit<ListContractsInput, 'page' | 'limit'>, max: number) {
    return this.filtered(tenantId, input).take(max).getMany();
  }

  private onLane(query: SelectQueryBuilder<TransporterContractEntity>, lane: ContractLane) {
    return query.andWhere(
      new Brackets((qb) =>
        qb
          .where('LOWER(TRIM(c.source_city)) = LOWER(TRIM(:sourceCity))')
          .andWhere('LOWER(TRIM(c.source_state)) = LOWER(TRIM(:sourceState))')
          .andWhere('LOWER(TRIM(c.destination_city)) = LOWER(TRIM(:destinationCity))')
          .andWhere('LOWER(TRIM(c.destination_state)) = LOWER(TRIM(:destinationState))'),
      ),
      { ...lane },
    );
  }

  /** Live contracts on the same lane whose validity overlaps [validFrom, validTo]. */
  findOverlapping(
    tenantId: string,
    lane: ContractLane,
    validFrom: string,
    validTo: string,
    excludeId?: string,
  ) {
    const query = this.onLane(
      this.withTransporter().andWhere('c.tenant_id = :tenantId', { tenantId }),
      lane,
    ).andWhere('c.valid_from <= :validTo AND c.valid_to >= :validFrom', { validFrom, validTo });
    if (excludeId) query.andWhere('c.id <> :excludeId', { excludeId });
    return query.orderBy('c.priority', 'ASC').getMany();
  }

  /** Contracts on the lane that are valid today — the "Lane allocation" box. */
  findActiveOnLane(tenantId: string, lane: ContractLane, excludeId?: string) {
    const query = this.onLane(
      this.withTransporter().andWhere('c.tenant_id = :tenantId', { tenantId }),
      lane,
    ).andWhere('c.valid_from <= CURRENT_DATE AND c.valid_to >= CURRENT_DATE');
    if (excludeId) query.andWhere('c.id <> :excludeId', { excludeId });
    return query.orderBy('c.priority', 'ASC').getMany();
  }

  async update(tenantId: string, id: string, data: ContractColumns) {
    const defined = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    await this.contracts.update({ id, tenantId, deletedAt: IsNull() }, defined);
    return this.findById(tenantId, id);
  }

  async softDelete(tenantId: string, id: string, actorId: string) {
    await this.contracts.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: actorId },
    );
  }

  count(tenantId: string) {
    return this.contracts.countBy({ tenantId, deletedAt: IsNull() });
  }
}
