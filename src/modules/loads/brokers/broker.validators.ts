import { z } from 'zod';
import { paginationQuery } from '../../../shared/validators/pagination';
import { BROKER_STATUSES } from './broker.types';

const filters = {
  status: z.enum(BROKER_STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
};

export const brokerValidators = {
  listBrokers: z.object({ query: paginationQuery.extend(filters) }),
  exportBrokers: z.object({ query: z.object(filters) }),
};

export type ListBrokersQuery = z.infer<typeof brokerValidators.listBrokers>['query'];
export type BrokerFilters = z.infer<typeof brokerValidators.exportBrokers>['query'];
