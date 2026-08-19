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

/** A LoadActivityEntity row plus the actor's display name/role, resolved via a batched lookup
 *  against auth's UserEntity — actorId itself carries no FK/relation (see the entity's doc
 *  comment), so this join happens in LoadActivityService, not the database. Both null when
 *  actorId is null (a system-triggered action) or the user record can no longer be found. */
export interface LoadActivityWithActor {
  id: string;
  tenantId: string;
  loadId: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: LoadActivityAction;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
