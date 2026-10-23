import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.types';
import { VehicleService } from '../masters/vehicle/vehicle.service';
import { LoadEventNotifier } from '../notifications/notifications.interface';
import { LoadActivityService } from './load-activity.service';
import { LoadRepository, UpdateLoadData } from './load.repository';
import { LoadEntity } from './entities/load.entity';
import { stageGateError, stageTransitionError } from './utils/load-stages';
import { LoadStatus } from './utils/loads.types';

/** The timestamp column each stage stamps when the load enters it. Delivered with issues shares
 *  deliveredAt with Delivered without issues — the truck unloaded once — and the settlement has
 *  its own deliveryIssueSettledAt, set by LoadService.settleDeliveryIssue. */
const STAGE_TIMESTAMP_FIELD: Partial<Record<LoadStatus, keyof UpdateLoadData>> = {
  bids_received: 'bidsReceivedAt',
  truck_assigned: 'truckAssignedAt',
  in_transit_loading: 'inTransitLoadingAt',
  reached_loading: 'atPlantAt',
  loaded: 'loadingConfirmedAt',
  in_transit_unloading: 'inTransitAt',
  reached_unloading: 'reachedDeliveryPointAt',
  closed: 'closedAt',
};

export interface StageTransitionInput {
  tenantId: string;
  loadId: string;
  to: LoadStatus;
  actorId: string;
  /** Set when the driver app made the move — audit_logs.user_id has an FK to auth.users that a
   *  masters.drivers id would violate, so the driver is carried in newData instead. */
  driverOwnerId?: string;
  /** Extra columns written in the same UPDATE as the status. */
  fields?: UpdateLoadData;
  /** Already-read row, to skip a re-read; its status is the expected `from`. */
  load?: LoadEntity;
  auditAction?: AuditAction;
  metadata?: Record<string, unknown>;
}

/**
 * The only writer of `loads.status`. Every move is checked against the load's route
 * (ROUTE_STAGES) and the allowed transitions (LOAD_STAGE_TRANSITIONS), stamps the stage's
 * timestamp, and is written as a conditional `WHERE status = <from>` update so two concurrent
 * calls can't both move the same load. Each move is recorded on the load's activity timeline and
 * the audit log, then reported to the load-event notifier.
 */
export class LoadStageService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly vehicleService: VehicleService,
    private readonly onLoadEvent?: LoadEventNotifier,
  ) {}

  async transition(input: StageTransitionInput): Promise<LoadEntity> {
    const { tenantId, loadId, to, actorId, driverOwnerId } = input;
    try {
      const load = input.load ?? (await this.repository.findById(tenantId, loadId));
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      const from = load.status;

      const error = stageTransitionError(load.sourceType, from, to) ?? stageGateError(load, to);
      if (error) throw new ConflictError(error);

      const now = new Date();
      const timestampField = STAGE_TIMESTAMP_FIELD[to];
      const fields: UpdateLoadData = {
        ...(timestampField ? { [timestampField]: now } : {}),
        ...input.fields,
        updatedBy: actorId,
      };
      const updated = await this.repository.updateStatus(tenantId, loadId, [from], to, fields);
      if (!updated) {
        throw new ConflictError('Load status update failed — it may have just changed');
      }

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'STATUS_CHANGED',
        from,
        to,
        input.metadata ?? null,
      );
      await this.auditService.log({
        tenantId,
        userId: driverOwnerId ? null : actorId,
        action:
          input.auditAction ??
          (to === 'closed'
            ? 'LOAD_CLOSED'
            : driverOwnerId
              ? 'LOAD_STATUS_UPDATED_BY_DRIVER'
              : 'LOAD_STATUS_UPDATED'),
        resourceType: 'load',
        oldData: { id: loadId, status: from },
        newData: driverOwnerId
          ? { id: loadId, status: to, driverId: actorId }
          : { id: loadId, status: to },
      });

      // The notification catalog still names its two handoffs after the old stage names; they're
      // job identifiers, not load statuses, so they stay as they are.
      if (to === 'in_transit_unloading') {
        await this.onLoadEvent?.({ kind: 'in_transit', tenantId, loadId, at: now });
      } else if (to === 'reached_unloading') {
        await this.onLoadEvent?.({ kind: 'reached_delivery_point', tenantId, loadId, at: now });
      }

      if (to === 'closed' && updated.vehicleId) {
        // Own-fleet loads carry a vehicleId — release it back to idle now that this was its one
        // active load (dispatch-planning's C-02 guarantees one active load per vehicle).
        await this.vehicleService.setOperationalStatus(tenantId, actorId, updated.vehicleId, {
          operationalStatus: 'idle',
          reason: `Load ${loadId} closed`,
        });
      }

      return updated;
    } catch (error) {
      rethrow(error, `Failed to move load to ${to}`);
    }
  }

  /**
   * Closes the load once everything it waits on is done, else returns it unchanged:
   * Delivered without issues (any issue settled) + E-POD accepted, and — for market and indent
   * loads — both advance and balance recorded. Own fleet has nothing to pay. Called after each
   * of those can become true (E-POD review, issue settlement, balance payment), whichever lands
   * last closes the load.
   */
  async closeIfReady(tenantId: string, actorId: string, load: LoadEntity): Promise<LoadEntity> {
    if (load.status !== 'delivered_ok' || load.podStatus !== 'accepted') return load;
    if (load.sourceType !== 'own_fleet' && !(load.advancePaidAt && load.balancePaidAt)) {
      return load;
    }
    return this.transition({ tenantId, loadId: load.id, to: 'closed', actorId, load });
  }
}
