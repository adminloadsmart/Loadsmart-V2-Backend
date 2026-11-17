import { DataSource, In, Not, Repository } from 'typeorm';
import { LoadRouteChangeEntity } from '../entities/load-route-change.entity';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoadPostingEntity } from '../load-posting/entities/load-posting.entity';
import { LoadRecipientEntity } from '../load-posting/entities/load-recipient.entity';
import { LoadBidEntity } from './load-bid.entity';
import { CreateLoadBidData } from '../utils/load-bid.interface';

export class LoadBidRepository {
  private readonly bids: Repository<LoadBidEntity>;
  private readonly postings: Repository<LoadPostingEntity>;
  private readonly recipients: Repository<LoadRecipientEntity>;

  constructor(dataSource: DataSource) {
    this.bids = dataSource.getRepository(LoadBidEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.recipients = dataSource.getRepository(LoadRecipientEntity);
  }

  listByLoad(tenantId: string, loadId: string): Promise<LoadBidEntity[]> {
    return this.bids.find({
      where: { tenantId, loadId },
      relations: { transporter: true },
      order: { createdAt: 'ASC' },
    });
  }

  findById(tenantId: string, loadId: string, id: string): Promise<LoadBidEntity | null> {
    return this.bids.findOne({ where: { tenantId, loadId, id }, relations: { transporter: true } });
  }

  /** The transporter's live bid on this load, if any — a new quote revises it. */
  findLive(tenantId: string, loadId: string, transporterId: string): Promise<LoadBidEntity | null> {
    return this.bids.findOneBy({ tenantId, loadId, transporterId, status: 'received' });
  }

  async create(data: CreateLoadBidData): Promise<LoadBidEntity> {
    const saved = await this.bids.save(this.bids.create(data));
    return (await this.findById(data.tenantId, data.loadId, saved.id))!;
  }

  async update(
    bid: LoadBidEntity,
    data: QueryDeepPartialEntity<LoadBidEntity>,
  ): Promise<LoadBidEntity> {
    await this.bids.update({ id: bid.id, tenantId: bid.tenantId }, data);
    return (await this.findById(bid.tenantId, bid.loadId, bid.id))!;
  }

  async markExpired(tenantId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.bids.update({ tenantId, id: In(ids), status: 'received' }, { status: 'expired' });
  }

  /** Accepts one bid, only if it is still live — the conditional update is the race guard
   *  against two accepts landing together. Returns false when it lost. */
  async accept(bid: LoadBidEntity, actorId: string): Promise<boolean> {
    const result = await this.bids.update(
      { id: bid.id, tenantId: bid.tenantId, status: 'received' },
      { status: 'accepted', decidedAt: new Date(), decidedBy: actorId },
    );
    return result.affected === 1;
  }

  async rejectOthers(tenantId: string, loadId: string, acceptedId: string, actorId: string) {
    await this.bids.update(
      { tenantId, loadId, status: 'received', id: Not(acceptedId) },
      { status: 'rejected', decidedAt: new Date(), decidedBy: actorId },
    );
  }

  /** Every bid still open on the load — rejected when the load is cancelled. */
  async rejectAllOpen(tenantId: string, loadId: string, actorId: string): Promise<void> {
    await this.bids.update(
      { tenantId, loadId, status: 'received' },
      { status: 'rejected', decidedAt: new Date(), decidedBy: actorId },
    );
  }

  /** Loadsmart's live bid on the load — a new one from placement replaces it. */
  findLiveLoadsmart(tenantId: string, loadId: string): Promise<LoadBidEntity | null> {
    return this.bids.findOneBy({ tenantId, loadId, source: 'loadsmart', status: 'received' });
  }

  async markRejected(bid: LoadBidEntity, actorId: string | null): Promise<void> {
    await this.bids.update(
      { id: bid.id, tenantId: bid.tenantId, status: 'received' },
      { status: 'rejected', decidedAt: new Date(), decidedBy: actorId },
    );
  }

  /** The indent contract's non-placement penalty, if it has one. */
  async findContractPenalty(tenantId: string, contractId: string): Promise<string | null> {
    const [row] = (await this.bids.manager.query(
      `SELECT "non_placement_penalty" AS "penalty" FROM "loads"."customer_contracts"
        WHERE "id" = $1 AND "tenant_id" = $2`,
      [contractId, tenantId],
    )) as { penalty: string | null }[];
    return row?.penalty ?? null;
  }

  recordRouteChange(data: Omit<LoadRouteChangeEntity, 'id' | 'load' | 'createdAt'>) {
    const repo = this.bids.manager.getRepository(LoadRouteChangeEntity);
    return repo.save(repo.create(data));
  }

  /** A rejected indent goes to the shipper's own transporters too: each active one becomes a
   *  recipient of the posting (status pending — nothing is sent from here), so the shipper can
   *  record their bids. */
  async addTransporterRecipients(tenantId: string, postingId: string): Promise<number> {
    const rows = (await this.bids.manager.query(
      `INSERT INTO "loads"."load_recipients" ("tenant_id", "posting_id", "recipient_type", "transporter_id")
       SELECT t."tenant_id", $2, 'transporter', t."id"
         FROM "masters"."transporters" t
        WHERE t."tenant_id" = $1 AND t."status" = 'active' AND t."deleted_at" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "loads"."load_recipients" r
                           WHERE r."posting_id" = $2 AND r."transporter_id" = t."id")
       RETURNING "id"`,
      [tenantId, postingId],
    )) as { id: string }[];
    return rows.length;
  }

  findPosting(tenantId: string, postingId: string): Promise<LoadPostingEntity | null> {
    return this.postings.findOne({
      where: { tenantId, id: postingId },
      relations: { pickupLoadingPoint: true },
    });
  }

  findTransporterRecipient(
    tenantId: string,
    postingId: string,
    transporterId: string,
  ): Promise<LoadRecipientEntity | null> {
    return this.recipients.findOneBy({
      tenantId,
      postingId,
      transporterId,
      recipientType: 'transporter',
    });
  }
}
