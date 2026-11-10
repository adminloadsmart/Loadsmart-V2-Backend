import { Between, DataSource, FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { LoadIssueReportEntity } from '../../loads/entities/load-issue-report.entity';
import { LoadAwardOutcomeEntity } from '../../loads/entities/load-award-outcome.entity';
import { LoadChargeEntity } from '../../loadsmart-ops/entities/load-charge.entity';
import { LoadClaimEntity } from '../../loadsmart-ops/entities/load-claim.entity';
import { LsInvoiceEntity } from '../../loadsmart-ops/entities/ls-invoice.entity';
import { TransporterEntity } from '../../masters/transporter/entities/transporter.entity';
import { OrganizationEntity } from '../../organization/entities/organization.entity';

/** Unloading free hours when the organization has none set — the database default. */
const DEFAULT_UNLOADING_FREE_HOURS = 4;

/** Everything a load fact is resolved from (Shipper Analytics §5 data sources). */
const LOAD_RELATIONS = {
  requisition: { customer: true, loadingPoint: true, customerDeliveryPoint: true },
  posting: {
    customer: true,
    pickupLoadingPoint: true,
    dropCustomerDeliveryPoint: true,
    dropLoadingPoint: true,
  },
  loadingPoint: true,
  cargoItems: { product: true },
  truckType: true,
  transporter: true,
  vehicle: { telemetryMeta: true },
  driver: true,
} as const;

export interface ShipperLoadRecords {
  loads: LoadEntity[];
  charges: LoadChargeEntity[];
  claims: LoadClaimEntity[];
  invoices: LsInvoiceEntity[];
  payments: LoadPaymentEntity[];
  issues: LoadIssueReportEntity[];
  awards: LoadAwardOutcomeEntity[];
}

// Reads across the loads, loadsmart-ops and masters modules directly through the DataSource, the
// same way Fleet Analytics does — a reporting concern, not a business-logic dependency. Plain
// Repository.find() with the aggregation done in the service (prefer-typeorm-no-raw-sql).
export class ShipperAnalyticsRepository {
  private readonly loads: Repository<LoadEntity>;
  private readonly charges: Repository<LoadChargeEntity>;
  private readonly claims: Repository<LoadClaimEntity>;
  private readonly invoices: Repository<LsInvoiceEntity>;
  private readonly payments: Repository<LoadPaymentEntity>;
  private readonly issues: Repository<LoadIssueReportEntity>;
  private readonly awards: Repository<LoadAwardOutcomeEntity>;
  private readonly transporters: Repository<TransporterEntity>;
  private readonly organizations: Repository<OrganizationEntity>;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.charges = dataSource.getRepository(LoadChargeEntity);
    this.claims = dataSource.getRepository(LoadClaimEntity);
    this.invoices = dataSource.getRepository(LsInvoiceEntity);
    this.payments = dataSource.getRepository(LoadPaymentEntity);
    this.issues = dataSource.getRepository(LoadIssueReportEntity);
    this.awards = dataSource.getRepository(LoadAwardOutcomeEntity);
    this.transporters = dataSource.getRepository(TransporterEntity);
    this.organizations = dataSource.getRepository(OrganizationEntity);
  }

  /**
   * Every load loaded or delivered between `from` and `to` (the previous period's start to the
   * selected period's end), with what the guide reads off each one. A load counts as dispatched
   * on its loading date and as delivered on its delivery date (§1), so both are matched.
   */
  async listLoadRecords(
    tenantId: string,
    range: { from: Date; to: Date },
  ): Promise<ShipperLoadRecords> {
    const within = Between(range.from, range.to);
    const base: FindOptionsWhere<LoadEntity> = { tenantId };
    const loads = await this.loads.find({
      where: [
        { ...base, inTransitAt: within },
        { ...base, inTransitAt: IsNull(), loadingConfirmedAt: within },
        { ...base, reachedDeliveryPointAt: within },
        { ...base, reachedDeliveryPointAt: IsNull(), deliveredAt: within },
      ],
      relations: LOAD_RELATIONS,
      order: { createdAt: 'ASC' },
    });
    const loadIds = loads.map((load) => load.id);
    if (loadIds.length === 0) {
      return { loads, charges: [], claims: [], invoices: [], payments: [], issues: [], awards: [] };
    }

    const byLoad = { tenantId, loadId: In(loadIds) };
    const [charges, claims, invoices, payments, issues, awards] = await Promise.all([
      this.charges.find({ where: { ...byLoad, status: 'approved' } }),
      this.claims.find({ where: byLoad }),
      this.invoices.find({ where: byLoad }),
      this.payments.find({
        where: [
          { ...byLoad, verificationStatus: IsNull() },
          { ...byLoad, verificationStatus: Not('rejected') },
        ],
      }),
      this.issues.find({ where: byLoad }),
      this.awards.find({ where: byLoad, order: { createdAt: 'ASC' } }),
    ]);
    return { loads, charges, claims, invoices, payments, issues, awards };
  }

  /** §9 "Transporters on the roster and corridors they serve". */
  listRoster(tenantId: string): Promise<TransporterEntity[]> {
    return this.transporters.find({
      where: { tenantId, deletedAt: IsNull(), status: 'active' },
      relations: { lanes: true },
    });
  }

  /** The organization's unloading free hours — used where a customer has none of its own. */
  async findUnloadingFreeHours(tenantId: string): Promise<number> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
      select: { id: true, unloadingFreeHours: true },
    });
    return organization?.unloadingFreeHours ?? DEFAULT_UNLOADING_FREE_HOURS;
  }
}
