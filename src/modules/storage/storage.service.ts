import { randomUUID } from 'crypto';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { PLATFORM_ADMIN_ROLE } from '../../shared/constants/roles';
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
    tenantId: string,
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

      const key = `${policy.keyPrefix}/${tenantId}/${randomUUID()}-${sanitizeFileName(input.fileName)}`;
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

  async confirmUpload(tenantId: string, fileId: string): Promise<FileEntity> {
    try {
      const file = await this.repository.findById(tenantId, fileId);
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

      const confirmed = await this.repository.markConfirmed(tenantId, fileId, head.contentLength);
      if (!confirmed) throw new ConflictError(`File ${fileId} could not be confirmed`);
      return confirmed;
    } catch (error) {
      rethrow(error, 'Failed to confirm upload');
    }
  }

  // The one method with two lookup paths: a tenant-scoped caller is always scoped to their own
  // tenant in SQL; a platform_admin with no tenant of their own (KYC review, etc.) is allowed to
  // look up any file by id. Any other caller with no tenant is denied, same as a genuine miss —
  // see storage.routes.ts for why this route isn't gated by requireTenant.
  async get(actor: FileAccessActor, fileId: string): Promise<FileWithUrlResult> {
    try {
      const file = actor.tenantId
        ? await this.repository.findById(actor.tenantId, fileId)
        : actor.role === PLATFORM_ADMIN_ROLE
          ? await this.repository.findByIdAny(fileId)
          : null;
      if (!file) throw new NotFoundError(`File ${fileId} not found`);

      const downloadUrl =
        file.status === 'confirmed'
          ? await this.s3.getPresignedDownloadUrl(file.key, DOWNLOAD_URL_EXPIRY_SECONDS)
          : null;
      return { file, downloadUrl };
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
