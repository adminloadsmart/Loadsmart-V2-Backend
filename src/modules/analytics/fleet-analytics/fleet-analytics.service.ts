import { rethrow } from '../../../shared/errors';
import { FleetAnalyticsRepository } from './fleet-analytics.repository';
import { FleetAnalyticsDateRange, FleetAnalyticsOverview } from './utils/fleet-analytics.interface';

export class FleetAnalyticsService {
  constructor(private readonly repository: FleetAnalyticsRepository) {}

  async getOverview(
    tenantId: string,
    range: FleetAnalyticsDateRange,
  ): Promise<FleetAnalyticsOverview> {
    try {
      const [emiSummary, sourceMix] = await Promise.all([
        this.repository.getEmiSummary(tenantId),
        this.repository.getSourceMix(tenantId, range),
      ]);

      return { emiSummary, sourceMix };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet analytics');
    }
  }
}
