import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { TransporterEntity } from './entities/transporter.entity';
import { TransporterContactEntity } from './entities/transporter-contact.entity';
import { TransporterLaneEntity } from './entities/transporter-lane.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { TransporterContractEntity } from '../contract/entities/transporter-contract.entity';
import { ValidationError } from '../../../shared/errors';
import {
  CreateTransporterInput,
  ListTransportersInput,
  TransporterContactInput,
  TransporterLaneInput,
} from './transporter.interface';

/** Columns written on create/update — everything except relations and timestamps. */
export type TransporterColumns = Partial<
  Omit<TransporterEntity, 'contacts' | 'lanes' | 'createdAt' | 'updatedAt'>
>;

/** Per-transporter load aggregates for the list: closed trips and freight still owed. */
export interface TransporterStats {
  tripsDone: number;
  freightOwed: string;
}

// Trip freight in SQL — per-ton rates multiplied by planned tonnes, same as computeShareAmount.
const LOAD_FREIGHT_SQL = `CASE WHEN l.freight_type = 'flat' THEN l.freight_value
  ELSE l.freight_value * l.planned_capacity_tonnes END`;

const SORT_SQL = {
  tripsDone: 'trips_done',
  freightOwed: 'freight_owed',
  createdAt: 't.created_at',
  name: 'LOWER(t.name)',
} as const;

export class TransporterRepository {
  private readonly transporters: Repository<TransporterEntity>;
  constructor(private readonly dataSource: DataSource) {
    this.transporters = dataSource.getRepository(TransporterEntity);
  }

  async create(
    data: CreateTransporterInput & { tenantId: string; createdBy: string },
    extra: TransporterColumns = {},
    manager?: EntityManager,
  ): Promise<TransporterEntity> {
    const repo = manager?.getRepository(TransporterEntity) ?? this.transporters;
    return repo.save(
      repo.create({
        tenantId: data.tenantId,
        createdBy: data.createdBy,
        name: data.name,
        phone: data.phone,
        rate: data.rate ?? null,
        email: data.email ?? null,
        gstin: data.gstin ?? null,
        msmeRegistration: data.msmeRegistration ?? null,
        companyType: data.companyType ?? null,
        status: data.status ?? 'active',
        advancePercentage: data.advancePercentage?.toString() ?? null,
        creditDays: data.creditDays ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        landmark: data.landmark ?? null,
        areaLocality: data.areaLocality ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pinCode: data.pinCode ?? null,
        bankAccountNumber: data.bankAccountNumber ?? null,
        bankIfsc: data.bankIfsc ?? null,
        bankAccountHolderName: data.bankAccountHolderName ?? null,
        bankNameBranch: data.bankNameBranch ?? null,
        upiVpa: data.upiVpa ?? null,
        gstTreatment: data.gstTreatment ?? null,
        trucksDeclared: data.trucksDeclared ?? null,
        deletedAt: null,
        updatedBy: null,
        ...extra,
      }),
    );
  }

  findById(tenantId: string, id: string, manager?: EntityManager) {
    const repo = manager?.getRepository(TransporterEntity) ?? this.transporters;
    return repo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.contacts', 'contact', 'contact.deleted_at IS NULL')
      .leftJoinAndSelect('t.lanes', 'lane', 'lane.deleted_at IS NULL')
      .where('t.tenant_id = :tenantId AND t.id = :id AND t.deleted_at IS NULL', { tenantId, id })
      .orderBy('contact.sort_order', 'ASC')
      .addOrderBy('lane.sort_order', 'ASC')
      .getOne();
  }
  findByPhone(tenantId: string, phone: string) {
    return this.transporters.findOneBy({ tenantId, phone, deletedAt: IsNull() });
  }

  /** Paged ids + aggregates first (sortable by trips/freight), then entities with relations. */
  async list(tenantId: string, input: ListTransportersInput) {
    const base = this.aggregateQuery(tenantId, input);
    const total = await base.clone().getCount();
    const sortColumn = SORT_SQL[input.sortBy ?? 'createdAt'];
    const rows = await base
      .select('t.id', 'id')
      .addSelect('COALESCE(agg.trips_done, 0)', 'trips_done')
      .addSelect('COALESCE(agg.freight_total, 0) - COALESCE(paid.paid_total, 0)', 'freight_owed')
      .orderBy(sortColumn, (input.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC')
      .addOrderBy('t.id', 'ASC')
      .offset((input.page - 1) * input.limit)
      .limit(input.limit)
      .getRawMany<{ id: string; trips_done: string; freight_owed: string }>();
    const ids = rows.map((row) => row.id);
    const entities = ids.length ? await this.findManyByIds(tenantId, ids) : [];
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const items = rows
      .filter((row) => byId.has(row.id))
      .map((row) => ({
        transporter: byId.get(row.id)!,
        stats: {
          tripsDone: Number(row.trips_done),
          freightOwed: Number(row.freight_owed).toFixed(2),
        },
      }));
    return { items, total };
  }

  /** Same filters as list(), unpaged (capped), for CSV export. */
  async listForExport(
    tenantId: string,
    input: Omit<ListTransportersInput, 'page' | 'limit'>,
    max: number,
  ) {
    return this.list(tenantId, { ...input, page: 1, limit: max });
  }

  async statsFor(tenantId: string, id: string): Promise<TransporterStats> {
    const row = await this.aggregateQuery(tenantId, {})
      .andWhere('t.id = :id', { id })
      .select('COALESCE(agg.trips_done, 0)', 'trips_done')
      .addSelect('COALESCE(agg.freight_total, 0) - COALESCE(paid.paid_total, 0)', 'freight_owed')
      .getRawOne<{ trips_done: string; freight_owed: string }>();
    return {
      tripsDone: Number(row?.trips_done ?? 0),
      freightOwed: Number(row?.freight_owed ?? 0).toFixed(2),
    };
  }

  private aggregateQuery(
    tenantId: string,
    input: Pick<ListTransportersInput, 'search' | 'status'>,
  ) {
    const query = this.transporters
      .createQueryBuilder('t')
      .leftJoin(
        (sub) =>
          sub
            .select('l.transporter_id', 'transporter_id')
            .addSelect(`COUNT(*) FILTER (WHERE l.status = 'closed')`, 'trips_done')
            .addSelect(`SUM(${LOAD_FREIGHT_SQL})`, 'freight_total')
            .from(LoadEntity, 'l')
            .where('l.tenant_id = :tenantId AND l.transporter_id IS NOT NULL')
            .groupBy('l.transporter_id'),
        'agg',
        'agg.transporter_id = t.id',
      )
      .leftJoin(
        (sub) =>
          sub
            .select('p.transporter_id', 'transporter_id')
            .addSelect('SUM(p.amount)', 'paid_total')
            .from(LoadPaymentEntity, 'p')
            .where('p.tenant_id = :tenantId AND p.transporter_id IS NOT NULL')
            .groupBy('p.transporter_id'),
        'paid',
        'paid.transporter_id = t.id',
      )
      .where('t.tenant_id = :tenantId AND t.deleted_at IS NULL', { tenantId });
    if (input.status) query.andWhere('t.status = :status', { status: input.status });
    if (input.search)
      query.andWhere(
        `(t.name ILIKE :search OR t.gstin ILIKE :search OR t.code ILIKE :search
          OR t.city ILIKE :search OR t.phone ILIKE :search)`,
        { search: `%${input.search}%` },
      );
    return query;
  }

  private findManyByIds(tenantId: string, ids: string[]) {
    return this.transporters
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.contacts', 'contact', 'contact.deleted_at IS NULL')
      .leftJoinAndSelect('t.lanes', 'lane', 'lane.deleted_at IS NULL')
      .where('t.tenant_id = :tenantId AND t.id IN (:...ids)', { tenantId, ids })
      .orderBy('contact.sort_order', 'ASC')
      .addOrderBy('lane.sort_order', 'ASC')
      .getMany();
  }

  async update(
    tenantId: string,
    id: string,
    data: TransporterColumns & { updatedBy: string },
    manager?: EntityManager,
  ) {
    const repo = manager?.getRepository(TransporterEntity) ?? this.transporters;
    const defined = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    await repo.update({ id, tenantId, deletedAt: IsNull() }, defined);
    return this.findById(tenantId, id, manager);
  }

  /** Id-aware sync of POC cards: `id` → update in place, no id → insert, missing → soft-delete. */
  async syncContacts(
    tenantId: string,
    transporterId: string,
    inputs: TransporterContactInput[],
    manager: EntityManager,
  ) {
    await this.syncChildren(
      manager.getRepository(TransporterContactEntity),
      tenantId,
      transporterId,
      inputs,
      (input, index) => ({
        fullName: input.fullName ?? null,
        designation: input.designation ?? null,
        phone: input.phone ?? null,
        isWhatsapp: input.isWhatsapp ?? false,
        email: input.email ?? null,
        sortOrder: index,
      }),
    );
  }

  /** Id-aware sync of operating lanes — same rules as syncContacts. */
  async syncLanes(
    tenantId: string,
    transporterId: string,
    inputs: TransporterLaneInput[],
    manager: EntityManager,
  ) {
    await this.syncChildren(
      manager.getRepository(TransporterLaneEntity),
      tenantId,
      transporterId,
      inputs,
      (input, index) => ({
        originCity: input.originCity,
        originState: input.originState ?? null,
        destinationCity: input.destinationCity,
        destinationState: input.destinationState ?? null,
        distanceKm: input.distanceKm ?? null,
        sortOrder: index,
      }),
    );
  }

  private async syncChildren<
    E extends TransporterContactEntity | TransporterLaneEntity,
    I extends { id?: string },
  >(
    repo: Repository<E>,
    tenantId: string,
    transporterId: string,
    inputs: I[],
    columns: (input: I, index: number) => Record<string, unknown>,
  ) {
    // Cast through `never`: TypeORM's FindOptionsWhere<E> can't be narrowed on a generic E.
    const owner = { tenantId, transporterId } as never;
    const existing = await repo.findBy({ ...(owner as object), deletedAt: IsNull() } as never);
    const existingIds = new Set(existing.map((row) => row.id));
    const keptIds = new Set<string>();
    const created: E[] = [];
    for (const [index, input] of inputs.entries()) {
      if (input.id) {
        if (!existingIds.has(input.id))
          throw new ValidationError(`${input.id} does not belong to this transporter`);
        keptIds.add(input.id);
        await repo.update(
          { id: input.id, ...(owner as object) } as never,
          columns(input, index) as never,
        );
      } else {
        const row = { ...(owner as object), ...columns(input, index), deletedAt: null };
        created.push(repo.create(row as never) as unknown as E);
      }
    }
    const removed = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
    if (removed.length)
      await repo.update(
        { id: In(removed), ...(owner as object) } as never,
        { deletedAt: new Date() } as never,
      );
    if (created.length) await repo.save(created as never);
  }

  /** Contracts (Settings → Masters → Contracts) still valid today for this transporter. */
  countLiveContracts(tenantId: string, transporterId: string): Promise<number> {
    return this.dataSource
      .getRepository(TransporterContractEntity)
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId AND c.transporter_id = :transporterId', {
        tenantId,
        transporterId,
      })
      .andWhere('c.deleted_at IS NULL AND c.valid_to >= CURRENT_DATE')
      .getCount();
  }

  async softDelete(tenantId: string, id: string, updatedBy: string) {
    return this.transporters.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy },
    );
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
