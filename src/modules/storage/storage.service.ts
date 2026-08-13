import { randomUUID } from 'crypto';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { PLATFORM_SCOPE_ROLES } from '../../shared/constants/roles';
import { S3Adapter } from '../../adapters/s3.adapter';
import { StorageRepository } from './storage.repository';
import { sanitizeFileName } from './utils/sanitize-filename';
import {
  DOWNLOAD_URL_EXPIRY_SECONDS,
  PRESIGNED_POST_EXPIRY_SECONDS,
  STALE_PENDING_MINUTES,
  UPLOAD_POLICIES,
} from './storage.constants';
import {
  FileAccessActor,
  FileWithUrlResult,
  GenerateUploadUrlInput,
  UploadUrlResult,
} from './storage.types';
import { FileEntity } from './entities/file.entity';

export class StorageService {
  constructor(
    private readonly repository: StorageRepository,
    private readonly s3: S3Adapter,
  ) {}

  async generateUploadUrl(
    tenantId: string | null,
    actorId: string,
    input: GenerateUploadUrlInput,
  ): Promise<UploadUrlResult> {
    try {
      const policy = UPLOAD_POLICIES[input.purpose];
      if (!policy.allowedMimeTypes.includes(input.mimeType)) {
        throw new ValidationError(
          `File type ${input.mimeType} is not allowed for purpose ${input.purpose}`,
        );
      }
      if (input.sizeBytes > policy.maxSizeBytes) {
        throw new ValidationError(
          `File exceeds the ${policy.maxSizeBytes}-byte limit for purpose ${input.purpose}`,
        );
      }

      // A tenant-less caller (platform-scope role, or a pre-org-creation org_admin) has no real
      // tenantId to segment the key by — 'platform' keeps the S3 path readable and collision-free
      // with any real tenant UUID, instead of interpolating the literal string "null".
      const tenantSegment = tenantId ?? 'platform';
      const key = `${policy.keyPrefix}/${tenantSegment}/${randomUUID()}-${sanitizeFileName(input.fileName)}`;
      const file = await this.repository.create(
        tenantId,
        actorId,
        input.purpose,
        key,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
      );
      const { url, fields } = await this.s3.createPresignedPost({
        key,
        contentType: input.mimeType,
        maxSizeBytes: policy.maxSizeBytes,
        expiresInSeconds: PRESIGNED_POST_EXPIRY_SECONDS,
      });
      return { file, uploadUrl: url, uploadFields: fields };
    } catch (error) {
      rethrow(error, 'Failed to generate upload URL');
    }
  }

  async confirmUpload(tenantId: string | null, fileId: string): Promise<FileEntity> {
    try {
      const file = tenantId
        ? await this.repository.findById(tenantId, fileId)
        : await this.repository.findByNullTenant(fileId);
      if (!file) throw new NotFoundError(`File ${fileId} not found`);
      if (file.status === 'confirmed') return file; // idempotent — already confirmed

      const head = await this.s3.headObject(file.key);
      if (!head) {
        // Left as 'pending' rather than flipped to 'failed' — the browser may still finish the
        // upload after this, and a later confirm call should be able to succeed without needing
        // a separate "retry from failed" path.
        throw new ConflictError(
          `Upload for file ${fileId} was never completed in S3 — try uploading again before confirming`,
        );
      }

      const confirmed = tenantId
        ? await this.repository.markConfirmed(tenantId, fileId, head.contentLength)
        : await this.repository.markConfirmedByNullTenant(fileId, head.contentLength);
      if (!confirmed) throw new ConflictError(`File ${fileId} could not be confirmed`);
      return confirmed;
    } catch (error) {
      rethrow(error, 'Failed to confirm upload');
    }
  }

  // Shared tail for get()/getByKey() — a confirmed file gets a fresh presigned download URL,
  // anything else (pending/failed) gets null rather than a URL to an object that may not exist.
  private async withDownloadUrl(file: FileEntity): Promise<FileWithUrlResult> {
    const downloadUrl =
      file.status === 'confirmed'
        ? await this.s3.getPresignedDownloadUrl(file.key, DOWNLOAD_URL_EXPIRY_SECONDS)
        : null;
    return { file, downloadUrl };
  }

  // The one method with two lookup paths: a tenant-scoped caller is always scoped to their own
  // tenant in SQL; any platform-scope caller (PLATFORM_SCOPE_ROLES — platform_admin, sales,
  // online/offline_kyc_desk, load_console), none of which have a tenant of their own, is allowed
  // to look up any file by id (KYC review, etc.). Any other tenant-less caller is denied, same
  // as a genuine miss. See storage.routes.ts for why this route isn't gated by requireTenant.
  async get(actor: FileAccessActor, fileId: string): Promise<FileWithUrlResult> {
    try {
      const file = actor.tenantId
        ? await this.repository.findById(actor.tenantId, fileId)
        : PLATFORM_SCOPE_ROLES.includes(actor.role)
          ? await this.repository.findByIdAny(fileId)
          : null;
      if (!file) throw new NotFoundError(`File ${fileId} not found`);
      return await this.withDownloadUrl(file);
    } catch (error) {
      rethrow(error, 'Failed to fetch file');
    }
  }

  // Same shape/security model as get(), but resolved by the S3 object key instead of the file's
  // own id — for a caller that only has a stored `key` reference (e.g. a future
  // organization_documents.file_key integration), not the file's id.
  async getByKey(actor: FileAccessActor, key: string): Promise<FileWithUrlResult> {
    try {
      const file = actor.tenantId
        ? await this.repository.findByKey(actor.tenantId, key)
        : PLATFORM_SCOPE_ROLES.includes(actor.role)
          ? await this.repository.findByKeyAny(key)
          : null;
      if (!file) throw new NotFoundError(`File with key ${key} not found`);
      return await this.withDownloadUrl(file);
    } catch (error) {
      rethrow(error, 'Failed to fetch file');
    }
  }

  async remove(tenantId: string, fileId: string): Promise<{ success: true }> {
    try {
      const file = await this.repository.findById(tenantId, fileId);
      if (!file) throw new NotFoundError(`File ${fileId} not found`);

      await this.s3.deleteObject(file.key);
      const deleted = await this.repository.softDelete(tenantId, fileId);
      if (!deleted) throw new ConflictError(`File ${fileId} could not be deleted`);
      return { success: true };
    } catch (error) {
      rethrow(error, 'Failed to delete file');
    }
  }

  // Plain, manually-callable cleanup — no cron/BullMQ wiring yet (src/jobs/queue-registry.ts is
  // still a no-op placeholder). Stale pending rows accumulate until this is invoked by hand or a
  // real scheduler eventually calls it.
  async purgeStalePending(
    olderThanMinutes: number = STALE_PENDING_MINUTES,
  ): Promise<{ purgedCount: number }> {
    try {
      const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
      const stale = await this.repository.findStalePending(cutoff);
      for (const file of stale) {
        try {
          await this.s3.deleteObject(file.key);
        } catch {
          // Best-effort — a stale pending row may never have had a real object behind it; one
          // failed delete shouldn't block the rest of the batch.
        }
        await this.repository.hardDelete(file.id);
      }
      return { purgedCount: stale.length };
    } catch (error) {
      rethrow(error, 'Failed to purge stale pending uploads');
    }
  }
}
