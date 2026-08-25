import { rethrow } from '../../../shared/errors';
import { ShipperAnalyticsRepository } from './shipper-analytics.repository';
import {
  ShipperAnalyticsOverview,
  ShipperAnalyticsRangeInput,
} from './shipper-analytics.interface';

export class ShipperAnalyticsService {
  constructor(private readonly repository: ShipperAnalyticsRepository) {}

  async getOverview(
    tenantId: string,
    range: ShipperAnalyticsRangeInput,
  ): Promise<ShipperAnalyticsOverview> {
    try {
      const [cards, tonnageByProduct, lanePerformance] = await Promise.all([
        this.repository.getCards(tenantId, range),
        this.repository.getTonnageByProduct(tenantId, range),
        this.repository.getLanePerformance(tenantId, range),
      ]);

      return { cards, tonnageByProduct, lanePerformance };
    } catch (error) {
      rethrow(error, 'Failed to fetch shipper analytics');
    }
  }
}
