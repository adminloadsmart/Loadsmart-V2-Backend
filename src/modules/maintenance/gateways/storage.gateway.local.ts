import { ValidationError } from '../../../shared/errors';
import { StorageService } from '../../storage/storage.service';
import { StorageGateway } from './storage.gateway';

const INVOICE_PURPOSE = 'maintenance/invoice';

export class StorageGatewayLocal implements StorageGateway {
  constructor(private readonly storageService: StorageService) {}

  async assertInvoiceUpload(tenantId: string, actorRole: string, key: string): Promise<void> {
    const { file } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
    if (file.purpose !== INVOICE_PURPOSE) {
      throw new ValidationError(`File ${key} was not uploaded for purpose ${INVOICE_PURPOSE}`);
    }
    if (file.status !== 'confirmed') {
      throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
    }
  }
}
