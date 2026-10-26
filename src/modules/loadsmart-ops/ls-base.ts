import { ConflictError, NotFoundError } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.types';
import { LoadActivityService } from '../loads/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { tripAmount } from './loadsmart-rules';

/** What the Loadsmart services share: the repository, the load's timeline and the audit log. */
export abstract class LsServiceBase {
  constructor(
    protected readonly repository: LoadsmartRepository,
    protected readonly loadActivityService: LoadActivityService,
    protected readonly auditService: AuditService,
    protected readonly now: () => Date = () => new Date(),
  ) {}

  protected async assertSourcing(id: string): Promise<LsSourcingEntity> {
    const sourcing = await this.repository.findSourcing(id);
    if (!sourcing) throw new NotFoundError(`Loadsmart sourcing ${id} not found`);
    return sourcing;
  }

  /** The sourcing of a load Loadsmart won — what every after-acceptance console action needs. */
  /** `tenantId` scopes it to one shipper — the shipper's own routes pass it. */
  protected async assertWonLoad(loadId: string, tenantId?: string): Promise<LsSourcingEntity> {
    const sourcing = await this.repository.findSourcingByLoad(loadId);
    if (
      !sourcing ||
      sourcing.status !== 'won' ||
      sourcing.load.sourceType !== 'loadsmart' ||
      (tenantId !== undefined && sourcing.tenantId !== tenantId)
    ) {
      throw new NotFoundError(`Loadsmart load ${loadId} not found`);
    }
    return sourcing;
  }

  /** One Loadsmart step on the shipper's load timeline and the audit log. */
  protected async step(
    sourcing: { tenantId: string; loadId: string; id: string },
    actorId: string,
    step: string,
    auditAction: AuditAction,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.loadActivityService.record(
      sourcing.tenantId,
      sourcing.loadId,
      actorId,
      'LOADSMART_STEP',
      null,
      step,
      metadata,
    );
    await this.auditService.log({
      tenantId: sourcing.tenantId,
      userId: actorId,
      action: auditAction,
      resourceType: 'ls_sourcing',
      newData: { id: sourcing.id, loadId: sourcing.loadId, step, ...metadata },
    });
  }

  /** The partner's trip amount — their rate in the load's freight basis. */
  protected partnerTrip(sourcing: LsSourcingEntity, load: LoadEntity): number {
    if (!sourcing.partnerRate) throw new ConflictError('No partner rate on this load');
    return tripAmount(
      Number(sourcing.partnerRate),
      load.freightType,
      Number(load.plannedCapacityTonnes),
    );
  }
}
