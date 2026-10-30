import {
  OrganizationDocumentEntity,
  OrganizationDocumentType,
} from './entities/organization-document.entity';
import { extractRegistryDetails, RegistryDetails } from './organization-document-registry-details';
import { isAutoVerifiable } from './organization-document-verification.service';
import { BUSINESS_DOCUMENT_ORDER } from './organization.constants';

/** Outcome of the automated government-registry (IDfy) check on one document, for reviewers:
 *  - verified: the registry has an active record for this number
 *  - inactive: the registry has a record, but not in good standing (e.g. a cancelled GSTIN)
 *  - not_found: the registry has no record for this number
 *  - failed: the check ran but didn't produce a usable answer
 *  - in_progress: submitted to IDfy, result not back yet
 *  - not_checked: never submitted (IDfy unconfigured, or a required input was missing) */
export type RegistryCheckStatus =
  'verified' | 'inactive' | 'not_found' | 'failed' | 'in_progress' | 'not_checked';

export interface RegistryCheck {
  status: RegistryCheckStatus;
  details: RegistryDetails | null;
  // Registry legal name vs the org's own legal name — null when either side is missing.
  nameMatches: boolean | null;
}

/** The org-level summary the verification queue shows in its "Gov Result" column. */
export type OrganizationGovResult = RegistryCheck & { documentType: OrganizationDocumentType };

// Who set a 'verified' document to verified — the IDfy worker writes with no acting user.
export type DocumentVerifiedBy = 'registry' | 'reviewer';

type CheckableDocument = Pick<
  OrganizationDocumentEntity,
  | 'documentType'
  | 'documentNumber'
  | 'rawResponse'
  | 'sourceReference'
  | 'verificationStatus'
  | 'updatedBy'
>;

// "M/S Sharma Logistics Private Limited" and "SHARMA LOGISTICS PVT. LTD." compare equal.
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^m\/s\.?\s*/, '')
    .replace(/\bprivate\b/g, 'pvt')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/[^a-z0-9]/g, '');
}

function namesMatch(registryName: string | null, organizationName: string | null): boolean | null {
  if (!registryName || !organizationName) return null;
  return normaliseName(registryName) === normaliseName(organizationName);
}

/** Null for a document the registry can't check (photos, or no number entered). */
export function registryCheckOf(
  document: CheckableDocument,
  organizationLegalName: string | null,
): RegistryCheck | null {
  if (!isAutoVerifiable(document)) return null;

  const raw = document.rawResponse;
  if (!raw) {
    return {
      status: document.sourceReference ? 'in_progress' : 'not_checked',
      details: null,
      nameMatches: null,
    };
  }

  const details = extractRegistryDetails(document.documentType, raw);
  const status: RegistryCheckStatus = details
    ? details.active
      ? 'verified'
      : 'inactive'
    : raw.status === 'id_not_found'
      ? 'not_found'
      : 'failed';
  return {
    status,
    details,
    nameMatches: namesMatch(details?.legalName ?? null, organizationLegalName),
  };
}

export function verifiedByOf(
  document: CheckableDocument,
  check: RegistryCheck | null,
): DocumentVerifiedBy | null {
  if (document.verificationStatus !== 'verified') return null;
  return document.updatedBy === null && check?.status === 'verified' ? 'registry' : 'reviewer';
}

export function govResultOf(
  documents: CheckableDocument[],
  organizationLegalName: string | null,
): OrganizationGovResult | null {
  for (const documentType of BUSINESS_DOCUMENT_ORDER) {
    const document = documents.find((candidate) => candidate.documentType === documentType);
    const check = document ? registryCheckOf(document, organizationLegalName) : null;
    if (check) return { documentType, ...check };
  }
  return null;
}
