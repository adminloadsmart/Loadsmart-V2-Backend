import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { fleetAnalyticsValidators } from './fleet-analytics.validators';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { authenticated, errorContent, TAGS } from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/fleet-analytics`;

const FILTER_NOTE =
  ' Shared filter bar: `period` (last_month | 3_months | 6_months [default] | custom with ' +
  '`from`/`to`) — presets are whole calendar months ending last month; `truckTypeId`; `heldAs` ' +
  '(owned_and_attached [default] | owned | financed | leased | attached); `vehicleId`; ' +
  '`laneKey` (`loadingPointId:customerDeliveryPointId`) and `customerId` narrow load figures; ' +
  '`yardId` is accepted but not applied (no yard model). Every response carries `unavailable` ' +
  '(field → why it reads 0: no fuel fills, tolls, driver pay, per-load distance, detention or ' +
  'on-road price yet) and `emptyBecause` (the filter that emptied the slice, or null). Every ' +
  'tab except compliance needs maintenance.costs.view.';

const TABS = [
  {
    path: 'summary',
    key: 'getSummary',
    description:
      'Header KPIs shown on every tab: all-in cost per km (standing + maintenance over km read ' +
      'off odometer readings; null when no km could be read), what the fleet cost to run (on ' +
      'the road = maintenance; standing = EMI/lease/insurance/fixed cost prorated over the ' +
      'period), tonnes moved and fleet utilisation (days on a load over truck-days).',
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
      'Operations tab: on-time (no more than 30 min past the promised delivery date), median ' +
      'lateness, turnaround, loading and unloading hours, on-time by lane, where the loads are ' +
      'and the load pipeline, from own-fleet loads. Detention needs geofence data and reads 0.',
  },
  {
    path: 'compliance',
    key: 'getCompliance',
    description:
      'Compliance tab (current state): vehicle papers expired / inside 7 days / inside 30 days ' +
      '/ in order, by document type, what to renew soonest, and driver licences. ' +
      '`standingPerDay` on renewals is omitted for a seat without maintenance.costs.view.',
  },
  {
    path: 'findings',
    key: 'getFindings',
    description:
      'Findings: up to four plain sentences naming what is worth acting on (idlest truck, ' +
      'replacement candidate, trucks blocked on papers, unplanned maintenance share, latest ' +
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
