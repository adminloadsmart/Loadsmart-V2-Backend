import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { PermissionHolder } from '../../shared/middleware/require-permission.middleware';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { LoadPostingService, PostLoadResult } from '../loads/load-posting/load-posting.service';
import { LoadPostingLookupService } from '../loads/load-posting/load-posting-lookup.service';
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
    private readonly lookupService: LoadPostingLookupService,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
  ) {}

  /** The shippers a load can be posted for: name, city and whether they are approved yet (only an
   *  approved shipper can have loads posted), with the time of their latest load. */
  async listShippers(search: string | undefined, limit: number) {
    try {
      const query = this.dataSource
        .getRepository(OrganizationEntity)
        .createQueryBuilder('org')
        .select([
          'org.id',
          'org.name',
          'org.companyLegalName',
          'org.operationalCity',
          'org.city',
          'org.status',
        ])
        .where('org.status IN (:...statuses)', { statuses: ['active', 'pending'] })
        .orderBy('org.name', 'ASC')
        .take(limit);
      if (search) {
        query.andWhere(
          '(org.name ILIKE :search OR org.companyLegalName ILIKE :search OR org.city ILIKE :search)',
          { search: `%${search}%` },
        );
      }
      const orgs = await query.getMany();
      const lastLoads = orgs.length
        ? await this.dataSource
            .getRepository(LoadPostingEntity)
            .createQueryBuilder('posting')
            .select('posting.tenantId', 'tenantId')
            .addSelect('MAX(posting.createdAt)', 'lastLoadAt')
            .where('posting.tenantId IN (:...ids)', { ids: orgs.map((org) => org.id) })
            .groupBy('posting.tenantId')
            .getRawMany<{ tenantId: string; lastLoadAt: Date }>()
        : [];
      const lastLoadAt = new Map(lastLoads.map((row) => [row.tenantId, row.lastLoadAt]));
      return orgs.map((org) => ({
        id: org.id,
        name: org.name ?? org.companyLegalName ?? 'Unnamed shipper',
        city: org.operationalCity ?? org.city ?? null,
        status: org.status,
        lastLoadAt: lastLoadAt.get(org.id) ?? null,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list the shippers');
    }
  }

  /** The posting form's pickers, read inside the chosen shipper's account. */
  readonly pickers = {
    rules: () => this.postingService.postingRules(),
    recentCustomers: (tenantId: string, limit: number) =>
      this.lookupService.recentCustomers(tenantId, limit),
    customers: (tenantId: string, search: string | undefined, limit: number) =>
      this.lookupService.searchCustomers(tenantId, search, limit),
    unloadingPoints: (tenantId: string, customerId: string, search?: string) =>
      this.lookupService.unloadingPoints(tenantId, customerId, search),
    loadingPoints: (tenantId: string, search?: string) =>
      this.lookupService.loadingPoints(tenantId, search),
    commodities: (tenantId: string, search?: string) =>
      this.lookupService.commodities(tenantId, search),
    truckOptions: (filters: Parameters<LoadPostingLookupService['truckOptions']>[0]) =>
      this.lookupService.truckOptions(filters),
  };

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
