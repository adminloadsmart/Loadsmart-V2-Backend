import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { PermissionHolder } from '../../shared/middleware/require-permission.middleware';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { LoadPostingService, PostLoadResult } from '../loads/load-posting/load-posting.service';
import { PostLoadInput } from '../loads/load-posting/utils/load-posting.interface';
import { StorageService } from '../storage/storage.service';

import { OnBehalfChannel } from './loadsmart.types';

export interface PostForShipperInput {
  posting: PostLoadInput;
  request: { channel: OnBehalfChannel; requestedBy: string; proofFileKey?: string };
}

/**
 * Loadsmart's Approval team (the KYC desks) — "Post a load for a shipper (L03)": pick the
 * shipper, record why Loadsmart is posting (WhatsApp or call, from whom) with proof, fill the
 * shipper's own posting form inside their account, tagged "Posted by Loadsmart · <user>". The
 * shipper sees it in their app at once and the load goes to Placement.
 */
export class LsApprovalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly postingService: LoadPostingService,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  async postForShipper(
    actor: PermissionHolder & { id: string },
    tenantId: string,
    input: PostForShipperInput,
    idempotencyKey?: string,
  ): Promise<PostLoadResult> {
    try {
      const org = await this.dataSource.getRepository(OrganizationEntity).findOne({
        where: { id: tenantId },
        select: { id: true, status: true },
      });
      if (!org) throw new NotFoundError(`Shipper ${tenantId} not found`);
      if (org.status !== 'active') {
        throw new ConflictError('The shipper is not approved yet — they cannot have loads posted');
      }
      // "The load goes to Placement" — a Loadsmart post is a market post.
      if (input.posting.mode !== 'market_fleet') {
        throw new ConflictError('Loadsmart posts market loads for a shipper');
      }
      if (input.request.proofFileKey) {
        await this.storageService.attachStaffUpload(
          actor.id,
          input.request.proofFileKey,
          'loads/posting-request',
          tenantId,
        );
      }

      const result = await this.postingService.post(
        tenantId,
        actor.id,
        actor,
        input.posting,
        idempotencyKey,
      );
      if (result.duplicate) return result;

      await this.dataSource.getRepository(LoadPostingEntity).update(
        { id: result.posting.id, tenantId },
        {
          postedOnBehalfBy: actor.id,
          onBehalfChannel: input.request.channel,
          onBehalfRequestedBy: input.request.requestedBy.trim(),
          onBehalfProofKey: input.request.proofFileKey ?? null,
        },
      );
      for (const load of result.loads) {
        await this.loadActivityService.record(
          tenantId,
          load.id,
          actor.id,
          'LOADSMART_STEP',
          null,
          'posted_by_loadsmart',
          { channel: input.request.channel, requestedBy: input.request.requestedBy },
        );
      }
      await this.auditService.log({
        tenantId,
        userId: actor.id,
        action: 'LS_POSTED_FOR_SHIPPER',
        resourceType: 'load',
        newData: {
          postingId: result.posting.id,
          loads: result.loads.map((load) => load.code),
          channel: input.request.channel,
          requestedBy: input.request.requestedBy,
        },
      });
      return result;
    } catch (error) {
      rethrow(error, 'Failed to post the load for the shipper');
    }
  }
}
