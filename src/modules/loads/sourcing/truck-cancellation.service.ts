import { DataSource, Repository } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { SettingsReader } from '../../settings/settings.types';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository, UpdateLoadData } from '../core/load.repository';
import { LoadStageService } from '../core/load-stage.service';
import {
  LoadCancellationEntity,
  TruckCancellationNextStep,
} from '../entities/load-cancellation.entity';
import { LoadEntity } from '../entities/load.entity';
import { TRUCK_CANCELLABLE_STAGES } from '../money/money-rules';

export interface CancelTruckInput {
  /** An active reason code from Super Admin → Settings (e.g. truck_cancelled_by_carrier). */
  reasonCode: string;
  note?: string;
  /** `new_truck`: the same transporter sends another truck. `reopen`: back to Created. */
  next: TruckCancellationNextStep;
}

/** The truck and driver come off the load; the memo has to be accepted again. */
const TRUCK_CLEARED: UpdateLoadData = {
  vehicleNumber: null,
  vehicleId: null,
  driverId: null,
  driverName: null,
  driverNumber: null,
  driverLicenceNumber: null,
  driverDateOfBirth: null,
  memoAcceptedAt: null,
  trackingSource: null,
};

/**
 * "Truck cancelled before loading": from Truck assigned until Loaded the shipper marks the truck
 * cancelled with a reason code (on a Loadsmart load, Placement does). Two ways on:
 *  - `new_truck` — the same transporter arranges another truck: back to Bids received with the
 *    award kept; the truck and driver are named and checked again and a new memo version goes to
 *    the shipper, whose acceptance returns the load to Truck assigned.
 *  - `reopen` — back to Created with no winner; transporters bid again (an indent's contracted
 *    transporter accepts again).
 * The cancellation, with the truck and driver that were on the load, is kept in
 * load_cancellations; the earlier memo stays in the memo versions.
 */
export class TruckCancellationService {
  private readonly cancellations: Repository<LoadCancellationEntity>;

  constructor(
    dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly stageService: LoadStageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly settings: SettingsReader,
  ) {
    this.cancellations = dataSource.getRepository(LoadCancellationEntity);
  }

  async cancel(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: CancelTruckInput,
    actorType: 'shipper' | 'ls_team' = 'shipper',
  ): Promise<LoadEntity> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      if (!TRUCK_CANCELLABLE_STAGES.includes(load.status)) {
        throw new ConflictError('A truck is cancelled from Truck assigned until Loaded');
      }
      const { values } = await this.settings.forLoad(load);
      const reason = values.reasonCodes.find(
        (code) => code.code === input.reasonCode && code.active,
      );
      if (!reason) throw new ValidationError(`"${input.reasonCode}" is not an active reason code`);

      const reopen = input.next === 'reopen';
      const fields: UpdateLoadData = {
        ...TRUCK_CLEARED,
        ...(reopen
          ? {
              awardedBidId: null,
              // A market load's transporter and rate go with the award; an indent keeps its
              // contracted transporter and rate.
              ...(load.postingType === 'market_fleet'
                ? { transporterId: null, freightValue: null }
                : {}),
            }
          : {}),
      };
      const updated = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: reopen ? 'truck_cancelled_reopen' : 'truck_cancelled_new_truck',
        actorType,
        actorId,
        load,
        auditAction: 'LOAD_TRUCK_CANCELLED',
        fields,
        metadata: { reasonCode: reason.code, note: input.note ?? null, next: input.next },
      });

      const cancellation = await this.cancellations.save(
        this.cancellations.create({
          tenantId,
          loadId,
          reasonCode: reason.code,
          note: input.note?.trim() || null,
          nextStep: input.next,
          fromStage: load.status,
          transporterId: load.transporterId,
          vehicleNumber: load.vehicleNumber,
          driverName: load.driverName,
          driverMobile: load.driverNumber,
          cancelledBy: actorId,
        }),
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'TRUCK_CANCELLED',
        load.vehicleNumber,
        input.next,
        { cancellationId: cancellation.id, reasonCode: reason.code, reason: reason.label },
      );
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to cancel the truck');
    }
  }

  async listForLoad(tenantId: string, loadId: string): Promise<LoadCancellationEntity[]> {
    try {
      const load = await this.loadRepository.findById(tenantId, loadId);
      if (!load) throw new NotFoundError(`Load ${loadId} not found`);
      return await this.cancellations.find({
        where: { tenantId, loadId },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      rethrow(error, 'Failed to list the truck cancellations');
    }
  }
}
