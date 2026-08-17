import { LoadActivityAction } from './loads.types';

export interface CreateLoadActivityData {
  tenantId: string;
  loadId: string;
  actorId: string | null;
  action: LoadActivityAction;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Record<string, unknown> | null;
}
