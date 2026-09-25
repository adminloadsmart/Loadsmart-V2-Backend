import { VehicleDocumentEntity } from '../../masters/vehicle/entities/vehicle-document.entity';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../../masters/vehicle/vehicle.type';
import { resolveDocumentStatus } from '../../masters/vehicle/vehicle.service';

export interface ExpiredDocument {
  documentType: string;
  expiryDate: string;
}

/**
 * The dated papers (RC, insurance, permit, PUC, fitness) that have expired — "Blocked on papers".
 * Uses the same resolveDocumentStatus dispatch's compliance warning uses, so the two agree on
 * which trucks have a paper problem.
 */
export function expiredDocuments(
  documents: VehicleDocumentEntity[] | undefined,
): ExpiredDocument[] {
  return (documents ?? [])
    .filter(
      (document) =>
        !document.deletedAt &&
        (VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY as readonly string[]).includes(document.documentType) &&
        document.expiryDate !== null &&
        resolveDocumentStatus(document.expiryDate) === 'expired',
    )
    .map((document) => ({ documentType: document.documentType, expiryDate: document.expiryDate! }))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}
