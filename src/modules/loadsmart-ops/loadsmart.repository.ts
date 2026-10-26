import { DataSource, In, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadChargeEntity } from './entities/load-charge.entity';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadRatingEntity } from './entities/load-rating.entity';
import { LsCommercialTermsEntity } from './entities/ls-commercial-terms.entity';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LsPartnerEntity } from './entities/ls-partner.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { PartnerPaymentType, SourcingStatus } from './loadsmart.types';

/** Every table of the Loadsmart ops module. Sourcings are looked up across tenants — the ops
 *  console is platform-wide — and carry the shipper's tenant for everything downstream. */
export class LoadsmartRepository {
  readonly partners: Repository<LsPartnerEntity>;
  readonly terms: Repository<LsCommercialTermsEntity>;
  readonly sourcings: Repository<LsSourcingEntity>;
  readonly partnerBids: Repository<LsPartnerBidEntity>;
  readonly charges: Repository<LoadChargeEntity>;
  readonly partnerPayments: Repository<LsPartnerPaymentEntity>;
  readonly claims: Repository<LoadClaimEntity>;
  readonly ratings: Repository<LoadRatingEntity>;
  readonly invoices: Repository<LsInvoiceEntity>;
  private readonly postings: Repository<LoadPostingEntity>;

  constructor(dataSource: DataSource) {
    this.partners = dataSource.getRepository(LsPartnerEntity);
    this.terms = dataSource.getRepository(LsCommercialTermsEntity);
    this.sourcings = dataSource.getRepository(LsSourcingEntity);
    this.partnerBids = dataSource.getRepository(LsPartnerBidEntity);
    this.charges = dataSource.getRepository(LoadChargeEntity);
    this.partnerPayments = dataSource.getRepository(LsPartnerPaymentEntity);
    this.claims = dataSource.getRepository(LoadClaimEntity);
    this.ratings = dataSource.getRepository(LoadRatingEntity);
    this.invoices = dataSource.getRepository(LsInvoiceEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
  }

  findPosting(tenantId: string, postingId: string): Promise<LoadPostingEntity | null> {
    return this.postings.findOneBy({ tenantId, id: postingId });
  }

  findSourcing(id: string): Promise<LsSourcingEntity | null> {
    return this.sourcings.findOne({ where: { id }, relations: { load: true, partner: true } });
  }

  findSourcingByLoad(loadId: string): Promise<LsSourcingEntity | null> {
    return this.sourcings.findOne({ where: { loadId }, relations: { load: true, partner: true } });
  }

  /** A console queue: sourcings in these states, optionally only those whose load is at one of
   *  these stages, oldest first. */
  listSourcings(
    statuses: SourcingStatus[],
    loadStatuses?: LoadStatus[],
  ): Promise<LsSourcingEntity[]> {
    return this.sourcings.find({
      where: {
        status: In(statuses),
        ...(loadStatuses ? { load: { status: In(loadStatuses) } } : {}),
      },
      relations: { load: true, partner: true },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async updateSourcing(id: string, data: QueryDeepPartialEntity<LsSourcingEntity>) {
    await this.sourcings.update({ id }, data);
    return (await this.findSourcing(id))!;
  }

  listPartnerBids(sourcingId: string): Promise<LsPartnerBidEntity[]> {
    return this.partnerBids.find({
      where: { sourcingId },
      relations: { partner: true },
      order: { createdAt: 'ASC' },
    });
  }

  async markOtherPartnerBidsLost(sourcingId: string, wonId: string): Promise<void> {
    await this.partnerBids.update({ sourcingId, id: Not(wonId) }, { status: 'lost' });
  }

  listCharges(tenantId: string, loadId: string): Promise<LoadChargeEntity[]> {
    return this.charges.find({ where: { tenantId, loadId }, order: { createdAt: 'ASC' } });
  }

  async approvedChargesTotal(tenantId: string, loadId: string): Promise<number> {
    const charges = await this.charges.findBy({ tenantId, loadId, status: 'approved' });
    return charges.reduce((sum, charge) => sum + Number(charge.amount), 0);
  }

  findPartnerPayment(sourcingId: string, paymentType: PartnerPaymentType) {
    return this.partnerPayments.findOneBy({ sourcingId, paymentType });
  }

  findClaim(loadId: string): Promise<LoadClaimEntity | null> {
    return this.claims.findOneBy({ loadId });
  }

  findInvoice(tenantId: string, loadId: string): Promise<LsInvoiceEntity | null> {
    return this.invoices.findOneBy({ tenantId, loadId });
  }

  listLoadsAt(statuses: LoadStatus[]): Promise<LsSourcingEntity[]> {
    return this.sourcings.find({
      where: { status: 'won', load: { status: In(statuses) } },
      relations: { load: true, partner: true },
      order: { updatedAt: 'ASC' },
      take: 200,
    });
  }

  /** Partners with no bid on this sourcing yet — Placement's call list. */
  async partnersWithoutBid(sourcingId: string): Promise<LsPartnerEntity[]> {
    const bids = await this.partnerBids.findBy({ sourcingId });
    const bidders = new Set(bids.map((bid) => bid.partnerId));
    const partners = await this.partners.find({
      where: { status: 'active' },
      order: { name: 'ASC' },
    });
    return partners.filter((partner) => !bidders.has(partner.id));
  }
}
