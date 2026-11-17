import { StorageService } from '../storage/storage.service';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { LoadEntity } from '../loads/entities/load.entity';

/** Adopts the payment advice Payables uploaded into the shipper's tenant and files it in the load's
 *  documents register as `payment_proof`, so Tracking can open it from the load. */
export async function attachPaymentProof(
  storage: StorageService,
  documents: LoadDocumentService,
  actorId: string,
  tenantId: string,
  load: LoadEntity,
  fileKey: string,
): Promise<void> {
  await storage.attachStaffUpload(actorId, fileKey, 'loads/payment-proof', tenantId);
  await documents.save(
    tenantId,
    load,
    { updatedBy: actorId },
    { userId: actorId, source: 'console' },
    [{ docType: 'payment_proof', fileKey }],
  );
}
