import { rethrow, ValidationError } from '../../../shared/errors';
import { StorageService } from '../../storage/storage.service';
import type { UploadPurpose } from '../../storage/storage.constants';

/** A file key a caller attaches to a load must be a confirmed upload of the tenant, made for the
 *  expected purpose. */
export async function assertConfirmedUpload(
  storage: StorageService,
  tenantId: string,
  actorRole: string,
  key: string,
  purpose: UploadPurpose,
): Promise<void> {
  try {
    const { file } = await storage.getByKey({ tenantId, role: actorRole }, key);
    if (file.purpose !== purpose) {
      throw new ValidationError(`File ${key} was not uploaded for purpose ${purpose}`);
    }
    if (file.status !== 'confirmed') {
      throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
    }
  } catch (error) {
    rethrow(error, 'Failed to verify the uploaded file');
  }
}
