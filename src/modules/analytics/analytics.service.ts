import { rethrow } from '../../shared/errors';
import { AnalyticsRepository } from './analytics.repository';
import { ShipperAnalyticsOverview } from './utils/analytics.interface';

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async getShipperOverview(tenantId: string): Promise<ShipperAnalyticsOverview> {
    try {
      const [cards, tonnageByProduct, lanePerformance] = await Promise.all([
        this.repository.getCards(tenantId),
        this.repository.getTonnageByProduct(tenantId),
        this.repository.getLanePerformance(tenantId),
      ]);

      return { cards, tonnageByProduct, lanePerformance };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics');
    }
  }
}
