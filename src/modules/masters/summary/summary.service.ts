import { DataSource, IsNull, Not } from 'typeorm';
import { rethrow } from '../../../shared/errors';
import { CustomerEntity } from '../../customers/entities/customer.entity';
import { TransporterEntity } from '../transporter/entities/transporter.entity';
import { LoadingPointEntity } from '../loading-point/entities/loading-point.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { TransporterContractEntity } from '../contract/entities/transporter-contract.entity';

export interface MastersSummary {
  customers: number;
  transporters: number;
  loadingPoints: number;
  products: number;
  contracts: number;
  alerts: {
    /** "1 customer has no verified GST record or agreed terms" — anything created against them
     *  defaults to payment against advance. */
    customersWithoutVerifiedGstOrTerms: number;
  };
}

/**
 * Settings → Masters landing cards. Counts by entity directly — customers live outside the masters
 * module (built later in composition-root), so this reads tables rather than services.
 */
export class MastersSummaryService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(tenantId: string): Promise<MastersSummary> {
    try {
      const live = { tenantId, deletedAt: IsNull() };
      const customers = this.dataSource.getRepository(CustomerEntity);
      const [
        customerCount,
        transporters,
        loadingPoints,
        products,
        contracts,
        customersWithoutVerifiedGstOrTerms,
      ] = await Promise.all([
        customers.countBy({ ...live, status: Not('rejected') }),
        this.dataSource.getRepository(TransporterEntity).countBy(live),
        this.dataSource
          .getRepository(LoadingPointEntity)
          .countBy({ ...live, status: Not('rejected') }),
        this.dataSource.getRepository(ProductEntity).countBy(live),
        this.dataSource.getRepository(TransporterContractEntity).countBy(live),
        customers
          .createQueryBuilder('c')
          .where('c.tenant_id = :tenantId AND c.deleted_at IS NULL', { tenantId })
          .andWhere(`c.status IN ('active', 'pending')`)
          .andWhere(`(c.gst_verification_status <> 'verified' OR c.credit_days IS NULL)`)
          .getCount(),
      ]);
      return {
        customers: customerCount,
        transporters,
        loadingPoints,
        products,
        contracts,
        alerts: { customersWithoutVerifiedGstOrTerms },
      };
    } catch (error) {
      rethrow(error, 'Failed to load masters summary');
    }
  }
}
