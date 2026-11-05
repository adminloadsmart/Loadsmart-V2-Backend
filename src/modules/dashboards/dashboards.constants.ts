import { LoadStatus } from '../loads/utils/loads.types';
import { LoadPipelineStageKey } from './utils/dashboards.interface';

/** Matches the frontend's default selected tab ("Last 15 days") when the caller omits a range. */
export const DEFAULT_RANGE_DAYS = 15;

/** Home "Where every load is" — which load statuses fall in each stage. 'closed' is in none of
 *  them (a closed load is no longer "open"); every other LoadStatus is in exactly one. */
export const LOAD_PIPELINE_STAGES: ReadonlyArray<{
  key: LoadPipelineStageKey;
  label: string;
  statuses: readonly LoadStatus[];
}> = [
  { key: 'being_sourced', label: 'Being sourced', statuses: ['created', 'bids_received'] },
  { key: 'truck_assigned', label: 'Truck assigned', statuses: ['truck_assigned'] },
  {
    key: 'on_the_road',
    label: 'On the road',
    statuses: [
      'in_transit_loading',
      'reached_loading',
      'loaded',
      'in_transit_unloading',
      'reached_unloading',
    ],
  },
  {
    key: 'delivered_or_money_open',
    label: 'Delivered, POD or money open',
    statuses: [
      'delivered_ok',
      'delivered_with_issues',
      'original_pod_received',
      'invoice_generated',
      'payment',
    ],
  },
];
