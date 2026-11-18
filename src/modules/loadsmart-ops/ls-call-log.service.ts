import { IsNull, Not } from 'typeorm';
import { rethrow } from '../../shared/errors';
import { TrackingClient } from '../../adapters/tracking.client';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LsCallLogEntity } from './entities/ls-call-log.entity';
import { CallContact, CallOutcome, EtaTarget } from './loadsmart.types';
import { LoadsmartRepository } from './loadsmart.repository';
import { LsServiceBase } from './ls-base';

export interface CallLogInput {
  contact: CallContact;
  phone?: string;
  outcome: CallOutcome;
  note?: string;
  /** Where the truck is, as the driver said it. Left out, tracking's position is used when fresh. */
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  /** When the truck reaches the loading (or unloading) point, as the driver said it. */
  etaAt?: Date;
  etaTarget?: EtaTarget;
}

/** A position older than this is not filled in automatically. */
const FRESH_POSITION_MS = 30 * 60 * 1000;

/**
 * Tracking's call log: every call about a Loadsmart load. A call can carry the truck's current
 * location and its ETA to the loading point; with SIM/GPS tracking on, the location is captured
 * from the tracking service when the caller gives none. The latest call with a location (or ETA)
 * is what the load's panel shows as the truck's current location and ETA.
 */
export class LsCallLogService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly trackingClient: TrackingClient,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  async logCall(actorId: string, loadId: string, input: CallLogInput): Promise<LsCallLogEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const now = this.now();
      let { latitude, longitude, locationLabel } = input;
      let locationSource: 'call' | 'tracking' | null =
        latitude !== undefined || locationLabel ? 'call' : null;
      if (!locationSource) {
        // SIM/GPS tracking is on: take the position the tracking service holds.
        const { position } = await this.trackingClient.getTrip(sourcing.tenantId, loadId);
        if (position && now.getTime() - position.recordedAt.getTime() <= FRESH_POSITION_MS) {
          latitude = position.lat;
          longitude = position.lng;
          locationLabel = position.placeName ?? undefined;
          locationSource = 'tracking';
        }
      }
      return await this.repository.callLogs.save(
        this.repository.callLogs.create({
          tenantId: sourcing.tenantId,
          loadId,
          sourcingId: sourcing.id,
          calledBy: actorId,
          calledAt: now,
          contact: input.contact,
          phone: input.phone ?? null,
          outcome: input.outcome,
          note: input.note ?? null,
          locationLabel: locationLabel ?? null,
          latitude: latitude === undefined ? null : String(latitude),
          longitude: longitude === undefined ? null : String(longitude),
          locationSource,
          etaAt: input.etaAt ?? null,
          etaTarget: input.etaAt ? (input.etaTarget ?? 'loading') : null,
        }),
      );
    } catch (error) {
      rethrow(error, 'Failed to log the call');
    }
  }

  async listCalls(loadId: string, limit = 100): Promise<LsCallLogEntity[]> {
    const sourcing = await this.assertWonLoad(loadId);
    return this.repository.callLogs.find({
      where: { loadId, tenantId: sourcing.tenantId },
      order: { calledAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  /** The latest call that gave a location, and the latest that gave an ETA — the truck's current
   *  location and its ETA as Tracking last heard them. */
  async latestFromCalls(loadId: string) {
    const [withLocation, withEta] = await Promise.all([
      this.repository.callLogs.findOne({
        where: { loadId, locationSource: Not(IsNull()) },
        order: { calledAt: 'DESC' },
      }),
      this.repository.callLogs.findOne({
        where: { loadId, etaAt: Not(IsNull()) },
        order: { calledAt: 'DESC' },
      }),
    ]);
    return { withLocation, withEta };
  }
}
