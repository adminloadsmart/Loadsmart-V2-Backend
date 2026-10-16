import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { authenticated, errorContent, TAGS } from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/fleet-analytics`;

const FILTER_NOTE =
  ' Follows the Fleet Analytics Metric Guide (v1.0). Shared filter bar: `period` (last_month | ' +
  '3_months | 6_months [default] | custom with `from`/`to`) — presets are whole calendar months ' +
  'ending last month, and days in period run to today if earlier; `bodyType` and `size` (keys ' +
  'from /fleet/filters); `heldAs` (owned_and_attached [default] | owned | financed | leased | ' +
  'attached); `vehicleId`; `laneKey` and `customerId` narrow load figures only. Fleet cost = ' +
  'running (maintenance) + fixed (EMI or lease, insurance, National Permit, driver salaries). ' +
  'Every response carries `unavailable` (field → why it reads 0 or is approximated: no GPS, ' +
  'fuel, tolls, trip expenses, e-challans, hire, truck price, state permit fee yet) and ' +
  '`emptyBecause` (the filter that emptied the slice, or null). Every tab except operations ' +
  'and compliance needs maintenance.costs.view.';

const TABS = [
  {
    path: 'summary',
    key: 'getSummary',
    description:
      'Header KPIs shown on every tab: all-in cost per km (fleet cost ÷ km driven by all ' +
      'trucks, from odometer readings; null when no km could be read), what the fleet cost to ' +
      'run (on the road = running cost; standing = fixed cost), tonnes moved and load ' +
      'utilisation (load days ÷ trucks × days in period).',
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
      'Maintenance tab: spend and spend per km, preventive share, downtime, mean distance ' +
      'between failures, fleet age, lifetime distance, tyres past 88% of life, planned vs ' +
      'unplanned by month, maintenance per km by vehicle (worst first), replacement candidates ' +
      'and tyre condition by vehicle. Km run come from odometer readings (job check-ins, tyre ' +
      'and battery readings, current odometer). Money fields are omitted for a seat without ' +
      'maintenance.costs.view, and planned vs unplanned then counts jobs instead.',
  },
  {
    path: 'operations',
    key: 'getOperations',
    description:
      'Operations tab: on-time (arrived within 4 hours of the due time), average turnaround, ' +
      'loading and unloading hours, the 12 worst lanes on time, where the loads are and the load ' +
      'pipeline. On the road now and the driver numbers are today’s position. Detention needs ' +
      'GPS and reads 0.',
  },
  {
    path: 'compliance',
    key: 'getCompliance',
    description:
      'Compliance tab (today’s position): insurance, fitness, PUC, permit and road tax expired ' +
      '/ 0–7 days / 8–30 days / in order, trucks with expired documents (they can still be ' +
      'dispatched), what to renew this week, and driver licences. ' +
      '`standingPerDay` on renewals is omitted for a seat without maintenance.costs.view.',
  },
  {
    path: 'findings',
    key: 'getFindings',
    description:
      'Findings: up to four plain sentences naming what is worth acting on (idlest truck, ' +
      'replacement candidate, trucks with expired documents, unplanned maintenance share, latest ' +
      'lane), ranked by money at stake, each with the tab and vehicle/lane holding the evidence.',
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
