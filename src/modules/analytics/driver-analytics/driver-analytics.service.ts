import { NotFoundError, rethrow } from '../../../shared/errors';
import { DriverAnalyticsRepository } from './driver-analytics.repository';
import {
  DriverAnalyticsDateRange,
  DriverAnalyticsOverview,
} from './utils/driver-analytics.interface';

export class DriverAnalyticsService {
  constructor(private readonly repository: DriverAnalyticsRepository) {}

  async getOverview(
    tenantId: string,
    driverId: string,
    range: DriverAnalyticsDateRange,
  ): Promise<DriverAnalyticsOverview> {
    try {
      const driver = await this.repository.getHeader(tenantId, driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);

      const { stats, trend } = await this.repository.getTripStatsAndTrend(
        tenantId,
        driverId,
        range,
      );

      return { driver, trips: stats, onTimeTrend: trend };
    } catch (error) {
      rethrow(error, 'Failed to fetch driver analytics');
    }
  }
}
