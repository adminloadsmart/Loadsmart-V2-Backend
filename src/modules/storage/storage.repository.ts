import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';
import { UploadPurpose } from './storage.constants';

export class StorageRepository {
  private readonly files: Repository<FileEntity>;

  constructor(dataSource: DataSource) {
    this.files = dataSource.getRepository(FileEntity);
  }

  create(
    tenantId: string | null,
    uploadedBy: string,
    purpose: UploadPurpose,
    key: string,
    originalFileName: string,
    mimeType: string,
    sizeBytes: number,
  ) {
    const file = this.files.create({
      tenantId,
      uploadedBy,
      purpose,
      key,
      originalFileName,
      mimeType,
      sizeBytes,
      status: 'pending',
      confirmedAt: null,
      deletedAt: null,
    });
    return this.files.save(file);
  }

  findById(tenantId: string, id: string) {
    return this.files.findOne({ where: { id, tenantId, deletedAt: IsNull() } });
  }

  // No tenant filter — used only by the service's platform-scope-role read bypass (get()). Never
  // call this from a write path or expose it to a normal tenant-scoped caller — it can return
  // any tenant's file.
  findByIdAny(id: string) {
    return this.files.findOne({ where: { id, deletedAt: IsNull() } });
  }

  // Tenant-less counterpart to findById/markConfirmed — matches tenant_id IS NULL specifically,
  // never a real tenant's row. Used only by the service's tenant-less confirmUpload path (a
  // platform-scope caller or a pre-org-creation org_admin confirming its own tenant-less
  // upload). Unlike findByIdAny, this can never surface a real tenant's file.
  findByNullTenant(id: string) {
    return this.files.findOne({ where: { id, tenantId: IsNull(), deletedAt: IsNull() } });
  }

  // key-based counterpart to findById/findByIdAny — for a caller that only has the S3 object
  // key on hand (e.g. organization_documents.file_key), not the file's own id. `key` has a
  // unique index (files_key_idx), so at most one row can ever match.
  findByKey(tenantId: string, key: string) {
    return this.files.findOne({ where: { key, tenantId, deletedAt: IsNull() } });
  }

  // No tenant filter — same scope/caution as findByIdAny, just keyed by `key` instead of `id`.
  findByKeyAny(key: string) {
    return this.files.findOne({ where: { key, deletedAt: IsNull() } });
  }

  async markConfirmed(tenantId: string, id: string, sizeBytes: number) {
    const result = await this.files.update(
      { id, tenantId, status: 'pending' },
      { status: 'confirmed', sizeBytes, confirmedAt: new Date() },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async markConfirmedByNullTenant(id: string, sizeBytes: number) {
    const result = await this.files.update(
      { id, tenantId: IsNull(), status: 'pending' },
      { status: 'confirmed', sizeBytes, confirmedAt: new Date() },
    );
    return result.affected === 1 ? this.findByNullTenant(id) : null;
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.files.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date() },
    );
    return result.affected === 1;
  }

  // Intentionally not tenant-scoped — an internal maintenance query across every tenant, used
  // only by purgeStalePending.
  findStalePending(cutoff: Date, limit = 100) {
    return this.files.find({
      where: { status: 'pending', createdAt: LessThan(cutoff) },
      take: limit,
    });
  }

  // Used only by purgeStalePending, after a best-effort S3 delete — a hard delete, not the
  // soft-delete used by the user-facing remove() path, since a stale pending row was never a
  // real, confirmed resource to begin with.
  async hardDelete(id: string): Promise<void> {
    await this.files.delete(id);
  }
}
