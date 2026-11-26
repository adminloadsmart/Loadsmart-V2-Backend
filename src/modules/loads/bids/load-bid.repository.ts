import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { CustomerContractEntity } from '../load-posting/entities/customer-contract.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { LoadRouteChangeEntity } from '../entities/load-route-change.entity';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoadPostingEntity } from '../load-posting/entities/load-posting.entity';
import { LoadRecipientEntity } from '../load-posting/entities/load-recipient.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { LoadBidEntity } from './load-bid.entity';
import { CreateLoadBidData } from '../utils/load-bid.interface';

export class LoadBidRepository {
  private readonly bids: Repository<LoadBidEntity>;
  private readonly postings: Repository<LoadPostingEntity>;
  private readonly recipients: Repository<LoadRecipientEntity>;
  private readonly users: Repository<UserEntity>;

  constructor(dataSource: DataSource) {
    this.bids = dataSource.getRepository(LoadBidEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.recipients = dataSource.getRepository(LoadRecipientEntity);
    this.users = dataSource.getRepository(UserEntity);
  }

  /** Full names of the users who entered bids — a shipper user or Loadsmart staff alike, so the
   *  bid card can say who logged the call. */
  async userNames(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map();
    const users = await this.users.find({
      where: { id: In(ids) },
      select: { id: true, fullName: true },
    });
    return new Map(users.flatMap((user) => (user.fullName ? [[user.id, user.fullName]] : [])));
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

  /** Carries bids onto a bid window that was extended: they're live again until its new end.
   *  Only bids still received or lapsed with the old window — never a decided one. */
  async reopen(tenantId: string, ids: string[], expiresAt: Date): Promise<void> {
    if (!ids.length) return;
    await this.bids.update(
      { tenantId, id: In(ids), status: In(['received', 'expired']) },
      { status: 'received', expiresAt },
    );
  }

  /** Accepts one bid, only if it is still live — the conditional update is the race guard
   *  against two accepts landing together. Returns false when it lost. */
  async accept(bid: LoadBidEntity, actorId: string | null): Promise<boolean> {
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
  /** Loadsmart's newest live bid on a load — it can have several with the shipper at once. */
  findLiveLoadsmart(tenantId: string, loadId: string): Promise<LoadBidEntity | null> {
    return this.bids.findOne({
      where: { tenantId, loadId, source: 'loadsmart', status: 'received' },
      order: { createdAt: 'DESC' },
    });
  }

  /** Every live Loadsmart bid on a load, newest first. */
  listLiveLoadsmart(tenantId: string, loadId: string): Promise<LoadBidEntity[]> {
    return this.bids.find({
      where: { tenantId, loadId, source: 'loadsmart', status: 'received' },
      order: { createdAt: 'DESC' },
    });
  }

  /** Loadsmart's live bid built on one partner bid — re-sending that broker's rate replaces it. */
  findLiveLoadsmartFor(
    tenantId: string,
    loadId: string,
    lsPartnerBidId: string,
  ): Promise<LoadBidEntity | null> {
    return this.bids.findOneBy({
      tenantId,
      loadId,
      source: 'loadsmart',
      status: 'received',
      lsPartnerBidId,
    });
  }

  async markRejected(bid: LoadBidEntity, actorId: string | null): Promise<void> {
    await this.bids.update(
      { id: bid.id, tenantId: bid.tenantId, status: 'received' },
      { status: 'rejected', decidedAt: new Date(), decidedBy: actorId },
    );
  }

  /** The indent contract's non-placement penalty, if it has one. */
  async findContractPenalty(tenantId: string, contractId: string): Promise<string | null> {
    const contract = await this.bids.manager.getRepository(CustomerContractEntity).findOne({
      where: { id: contractId, tenantId },
      select: { id: true, nonPlacementPenalty: true },
    });
    return contract?.nonPlacementPenalty ?? null;
  }

  recordRouteChange(data: Omit<LoadRouteChangeEntity, 'id' | 'load' | 'createdAt'>) {
    const repo = this.bids.manager.getRepository(LoadRouteChangeEntity);
    return repo.save(repo.create(data));
  }

  /** A rejected indent goes to the shipper's own transporters too: each active one becomes a
   *  recipient of the posting (status pending — nothing is sent from here), so the shipper can
   *  record their bids. */
  async addTransporterRecipients(tenantId: string, postingId: string): Promise<number> {
    const { manager } = this.bids;
    const transporters = await manager.getRepository(TransporterEntity).find({
      where: { tenantId, status: 'active', deletedAt: IsNull() },
      select: { id: true },
    });
    if (!transporters.length) return 0;
    const existing = await this.recipients.find({
      where: { postingId, transporterId: In(transporters.map((t) => t.id)) },
      select: { id: true, transporterId: true },
    });
    const already = new Set(existing.map((r) => r.transporterId));
    const fresh = transporters.filter((t) => !already.has(t.id));
    if (!fresh.length) return 0;
    await this.recipients.insert(
      fresh.map((t) => ({
        tenantId,
        postingId,
        recipientType: 'transporter' as const,
        transporterId: t.id,
      })),
    );
    return fresh.length;
  }

  findPosting(tenantId: string, postingId: string): Promise<LoadPostingEntity | null> {
    return this.postings.findOne({
      where: { tenantId, id: postingId },
      relations: { pickupLoadingPoint: true },
    });
  }

  /** Minutes added to the posting's 4-hour bid window ("Extend"). */
  async setBidWindowExtraMinutes(tenantId: string, postingId: string, minutes: number) {
    await this.postings.update({ tenantId, id: postingId }, { bidWindowExtraMinutes: minutes });
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

  /** The transporter's answer kept on its recipient row (as a WhatsApp Accept / Reject does), so
   *  the shipper sees it on the load. */
  async recordRecipientReply(
    recipientId: string,
    reply: 'accepted' | 'rejected',
    at: Date,
  ): Promise<void> {
    await this.recipients.update({ id: recipientId }, { replyStatus: reply, repliedAt: at });
  }
}
