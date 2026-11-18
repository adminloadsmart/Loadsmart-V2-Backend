import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { VehicleService } from '../../masters/vehicle/vehicle.service';
import { LoadEventNotifier } from '../../notifications/notifications.interface';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository, UpdateLoadData } from './load.repository';
import { LoadEntity } from '../entities/load.entity';
import { decideStage, StageActorType, StageRuleLoad, StageTrigger } from './stage-rules';
import { DELIVERED_LOAD_STATUSES, LoadStatus } from '../utils/loads.types';
import { LoadStageHook, StageTransitionInput } from '../utils/load.interface';
import { LoadStageHistoryRepository } from './load-stage-history.repository';
import { LoadStageHistoryEntity, StageChannel } from '../entities/load-stage-history.entity';

/** The timestamp column each stage stamps when the load enters it. Delivered with issues shares
 *  deliveredAt with Delivered — the truck unloaded once — and the resolution has its own
 *  deliveryIssueSettledAt, set by LoadService.settleDeliveryIssue. */
const STAGE_TIMESTAMP_FIELD: Partial<Record<LoadStatus, keyof UpdateLoadData>> = {
  bids_received: 'bidsReceivedAt',
  truck_assigned: 'truckAssignedAt',
  in_transit_loading: 'inTransitLoadingAt',
  reached_loading: 'atPlantAt',
  loaded: 'loadingConfirmedAt',
  in_transit_unloading: 'inTransitAt',
  reached_unloading: 'reachedDeliveryPointAt',
  invoice_generated: 'invoiceGeneratedAt',
  payment: 'paymentSubmittedAt',
  closed: 'closedAt',
};

function actorTypeOf(input: StageTransitionInput): StageActorType {
  if (input.actorType) return input.actorType;
  if (input.driverOwnerId) return 'driver';
  return input.actorId === null ? 'system' : 'shipper';
}

function channelOf(input: StageTransitionInput, actorType: StageActorType): StageChannel {
  if (input.channel) return input.channel;
  if (actorType === 'driver') return 'driver_app';
  if (actorType === 'ls_team') return 'console';
  if (actorType === 'system') return input.metadata?.source === 'tracking' ? 'tracking' : 'system';
  return 'web';
}

export interface StageHistoryView {
  stage: LoadStatus;
  route: string | null;
  trigger: string;
  actorType: StageActorType;
  actorId: string | null;
  channel: StageChannel;
  enteredAt: string;
  exitedAt: string | null;
  /** Time in the stage so far (still open) or in total (left), in minutes. */
  minutes: number;
}

function toHistoryView(row: LoadStageHistoryEntity, now = new Date()): StageHistoryView {
  const end = row.exitedAt ?? now;
  return {
    stage: row.stage,
    route: row.route,
    trigger: row.trigger,
    actorType: row.actorType,
    actorId: row.actorId,
    channel: row.channel,
    enteredAt: row.enteredAt.toISOString(),
    exitedAt: row.exitedAt?.toISOString() ?? null,
    minutes: Math.max(0, Math.round((end.getTime() - row.enteredAt.getTime()) / 60_000)),
  };
}

/**
 * The only writer of `loads.status` and `loads.route`. A caller reports a trigger; the trigger
 * table (stage-rules.ts) decides where it takes the load on its route, for that kind of actor,
 * and what must already be true. The move is a conditional `WHERE status = <from>` update so two
 * concurrent calls can't both move the same load, written in one transaction with its
 * load_stage_history row (the stage left is closed, the new one opened). It is then recorded on the
 * load's activity timeline and the audit log, and reported to the load-event notifier and the
 * stage hooks.
 *
 * A trigger that keeps the stage (an award at Bids received) still goes through here: it changes
 * who has the load, which is the route's business.
 */
export class LoadStageService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly vehicleService: VehicleService,
    private readonly history: LoadStageHistoryRepository,
    private readonly onLoadEvent?: LoadEventNotifier,
    /** Queues the no-tracking alerts for the stage (alerts/load-alert-scheduler.ts). Never throws. */
    private readonly onStageEntered?: LoadStageHook,
  ) {}

  async transition(input: StageTransitionInput): Promise<LoadEntity> {
    const { tenantId, loadId, trigger, actorId, driverOwnerId } = input;
    try {
      const load = input.load ?? (await this.repository.findById(tenantId, loadId));
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const from = load.status;

      const actorType = actorTypeOf(input);
      const decision = decideStage(
        load,
        trigger,
        actorType,
        (input.fields ?? {}) as Partial<StageRuleLoad>,
      );
      if (!decision.ok) {
        throw new ConflictError(decision.message, {
          code: decision.code,
          trigger,
          missing: decision.missing,
        });
      }
      const { to, effect } = decision;
      const moves = to !== from;

      const now = new Date();
      const timestampField = moves ? STAGE_TIMESTAMP_FIELD[to] : undefined;
      const fields: UpdateLoadData = {
        ...(timestampField ? { [timestampField]: now } : {}),
        ...input.fields,
        ...effect,
        updatedBy: actorId,
      };
      const updated = await this.history.transaction(async (manager) => {
        const row = await this.repository.updateStatus(
          tenantId,
          loadId,
          [from],
          to,
          fields,
          manager,
        );
        if (row && moves) {
          await this.history.recordMove(manager, {
            tenantId,
            loadId,
            stage: to,
            route: row.route,
            trigger,
            actorType,
            actorId,
            channel: channelOf(input, actorType),
            enteredAt: now,
            metadata: input.metadata ?? null,
          });
        }
        return row;
      });
      if (!updated) {
        throw new ConflictError('Load status update failed — it may have just changed');
      }

      const metadata = { trigger, ...(input.metadata ?? {}) };
      if (moves) {
        await this.loadActivityService.record(
          tenantId,
          loadId,
          actorId,
          'STATUS_CHANGED',
          from,
          to,
          metadata,
        );
      }
      await this.auditService.log({
        tenantId,
        userId: driverOwnerId ? null : actorId,
        action:
          input.auditAction ??
          (actorId === null ? 'LOAD_STATUS_UPDATED_BY_GEOFENCE' : undefined) ??
          (to === 'closed'
            ? 'LOAD_CLOSED'
            : driverOwnerId
              ? 'LOAD_STATUS_UPDATED_BY_DRIVER'
              : 'LOAD_STATUS_UPDATED'),
        resourceType: 'load',
        oldData: { id: loadId, status: from, route: load.route },
        newData: {
          id: loadId,
          status: to,
          route: updated.route,
          trigger,
          ...(driverOwnerId ? { driverId: actorId } : {}),
        },
      });
      if (!moves) return updated;

      // The notification catalog still names its handoffs after the old stage names; they're
      // job identifiers, not load statuses, so they stay as they are. A tracking move passes its
      // own time in `fields` — the event carries that, not the processing time.
      const at = (timestampField && (input.fields?.[timestampField] as Date | undefined)) || now;
      if (to === 'reached_loading') {
        await this.onLoadEvent?.({ kind: 'at_plant', tenantId, loadId, at });
      } else if (to === 'in_transit_unloading') {
        await this.onLoadEvent?.({ kind: 'in_transit', tenantId, loadId, at });
      } else if (to === 'reached_unloading') {
        await this.onLoadEvent?.({ kind: 'reached_delivery_point', tenantId, loadId, at });
      }
      // "Every stage change sends the shipper an in-app notification" (load module spec p.30) —
      // the notifier sends the generic card only for stages without a notification of their own.
      await this.onLoadEvent?.({ kind: 'stage_changed', tenantId, loadId, to, at });

      // Award record (Shipper Analytics §5): the memo accepted is the transporter's acceptance of
      // the load it won.
      if (to === 'truck_assigned' && updated.transporterId && updated.route !== 'own_fleet') {
        await this.repository.recordAwardOutcomes(
          tenantId,
          loadId,
          updated.transporterId,
          ['won', 'accepted'],
          actorId,
        );
      }

      await this.onStageEntered?.(updated, to);

      const delivered = DELIVERED_LOAD_STATUSES.includes(to);
      if ((delivered || to === 'closed' || to === 'cancelled') && updated.vehicleId) {
        // Own-fleet loads carry a vehicleId — release it back to idle as soon as the load is
        // delivered so it can take the next load; closing repeats the write harmlessly. Tracking
        // moves have no actor, so fall back to the load's last editor.
        const releasedBy = actorId ?? updated.updatedBy;
        if (releasedBy) {
          await this.vehicleService.setOperationalStatus(tenantId, releasedBy, updated.vehicleId, {
            operationalStatus: 'idle',
            reason: `Load ${loadId} ${delivered ? 'delivered' : to}`,
          });
        }
      }

      return updated;
    } catch (error) {
      rethrow(error, `Failed to apply "${trigger}" to the load`);
    }
  }

  /** The stages the load has been through, oldest first, with how long it spent in each. */
  async historyFor(tenantId: string, loadId: string): Promise<StageHistoryView[]> {
    try {
      const load = await this.repository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const rows = await this.history.listForLoad(tenantId, loadId);
      return rows.map((row) => toHistoryView(row));
    } catch (error) {
      rethrow(error, 'Failed to read the stage history');
    }
  }

  /** Takes `trigger` only if the table allows it right now, else returns the load unchanged —
   *  for steps that happen as soon as their last condition is met (paying, closing). */
  async advanceIfReady(
    tenantId: string,
    actorId: string | null,
    load: LoadEntity,
    trigger: StageTrigger,
    actorType: StageActorType = 'system',
  ): Promise<LoadEntity> {
    if (!decideStage(load, trigger, actorType).ok) return load;
    try {
      return await this.transition({
        tenantId,
        loadId: load.id,
        trigger,
        actorType,
        actorId,
        load,
      });
    } catch (error) {
      // A concurrent call got there first.
      if (error instanceof ConflictError) {
        return (await this.repository.findById(tenantId, load.id)) ?? load;
      }
      throw error;
    }
  }

  /** Closes the load once nothing is owed either way (the `settled` rules): own fleet from
   *  Delivered with the POD accepted; own transporter / indent from Payment with advance and
   *  balance paid; Loadsmart from Payment with the shipper's payment in and the carrier's balance
   *  paid. Called after each of those can become true — whichever lands last closes the load. */
  closeIfReady(tenantId: string, actorId: string | null, load: LoadEntity): Promise<LoadEntity> {
    return this.advanceIfReady(tenantId, actorId, load, 'settled');
  }
}
