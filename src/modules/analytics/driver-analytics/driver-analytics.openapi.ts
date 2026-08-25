import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, errorContent } from '../../../shared/openapi/core';
import { driverAnalyticsValidators } from './driver-analytics.validators';

const BASE = `${API_VERSION_PREFIX}/driver-analytics`;

export function registerDriverAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/overview`,
    tags: [TAGS.ANALYTICS],
    operationId: 'driverAnalytics.getOverview',
    ...authenticated(
      'Driver Analytics overview for one driver: header (license, years experience from ' +
        'dateOfJoining, current active/primary vehicle link), trip stats (total/onTime/late, ' +
        'delivered-subset only), and a monthly on-time trend bucketed by deliveredAt. ' +
        '`from`/`to` (createdAt, either or both omittable) scope trips/trend; header is never ' +
        'date-scoped. On-time is date-level only — no committed delivery time is stored anywhere, ' +
        'so this can never report minutes-late.',
    ),
    request: {
      params: driverAnalyticsValidators.getOverview.shape.params,
      query: driverAnalyticsValidators.getOverview.shape.query,
    },
    responses: {
      200: {
        description:
          '{ driver: { id, fullName, licenseNumber, licenseExpiry, yearsExperience, currentVehicle }, ' +
          'trips: { total, onTime, late, onTimePercentage }, onTimeTrend: [{ month, tripsCount, onTimePercentage }] }',
      },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
    },
  });
}
