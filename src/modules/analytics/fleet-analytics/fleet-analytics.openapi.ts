import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { authenticated, errorContent, TAGS } from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/fleet-analytics`;

const FILTER_NOTE =
  ' Shared filter bar: `period` (last_month | 3_months | 6_months [default] | custom with ' +
  '`from`/`to`) — presets are whole calendar months ending last month; `truckTypeId`; `heldAs` ' +
  '(owned_and_attached [default] | owned | financed | leased | attached). `yardId` and ' +
  '`customerId` are accepted but not applied yet. Load/dispatch-derived figures (km, trips, ' +
  'tonnes, on-time, detention, lanes, fuel, tolls, hire) are 0 or [] until loads are wired in.';

const TABS = [
  {
    path: 'summary',
    key: 'getSummary',
    description:
      'Header KPIs shown on every tab: cost per km, what the fleet cost to run (on the road = ' +
      'maintenance; standing = EMI/lease/insurance/fixed cost prorated over the period), cost ' +
      'per tonne-km and fleet utilisation.',
  },
  {
    path: 'overview',
    key: 'getOverview',
    description:
      'Overview tab: load KPIs, expired compliance, trucks in service, open breakdowns, idle ' +
      'standing cost, monthly cost and cost build-up, owned vs attached, cost by lane.',
  },
  {
    path: 'utilisation',
    key: 'getUtilisation',
    description:
      'Utilisation tab: truck-days split into on a load / standing / workshop / blocked on ' +
      'paper with the fixed cost each carried, and the least-used trucks.',
  },
  {
    path: 'cost',
    key: 'getCost',
    description:
      'Cost tab: per-km figures, monthly EMI and lease, operating cost by head, cost by lane, ' +
      'by truck class and by truck.',
  },
  {
    path: 'energy',
    key: 'getEnergy',
    description:
      'Energy tab: mileage and energy cost per km by powertrain, class and lane (all 0 until ' +
      'fuel logs and loads exist; powertrain and class rows carry vehicle counts).',
  },
  {
    path: 'maintenance',
    key: 'getMaintenance',
    description:
      'Maintenance tab: spend, preventive share, downtime, breakdowns, fleet age, lifetime ' +
      'distance, tyres past 88% of life, planned vs unplanned by month, cost by vehicle and ' +
      'tyre condition by vehicle.',
  },
  {
    path: 'operations',
    key: 'getOperations',
    description:
      'Operations tab: on-time, turnaround, detention and load pipeline (all 0 for now).',
  },
  {
    path: 'compliance',
    key: 'getCompliance',
    description:
      'Compliance tab (current state): vehicle papers expired / inside 7 days / inside 30 days ' +
      '/ in order, by document type, what to renew soonest, and driver licences.',
  },
] as const;

export function registerFleetAnalyticsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/fleet/filters`,
    tags: [TAGS.ANALYTICS],
    operationId: 'fleetAnalytics.getFilters',
    ...authenticated(
      'Fleet Analytics filter options: periods, truck classes, held-as options, yards ' +
        '(empty until a yard model exists) and customers.',
    ),
    responses: { 200: { description: 'Filter dropdown options' } },
  });

  for (const tab of TABS) {
    registry.registerPath({
      method: 'get',
      path: `${BASE}/fleet/${tab.path}`,
      tags: [TAGS.ANALYTICS],
      operationId: `fleetAnalytics.${tab.key}`,
      ...authenticated(tab.description + FILTER_NOTE),
      request: { query: fleetAnalyticsValidators[tab.key].shape.query },
      responses: {
        200: { description: `Fleet Analytics ${tab.path}` },
        400: { description: 'Validation failed', ...errorContent },
      },
    });
  }
}
