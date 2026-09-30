import { EntityManager } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { OrganizationDocumentRepository } from './organization-document.repository';
import {
  DocumentVerificationStatus,
  OrganizationDocumentEntity,
  OrganizationDocumentInput,
} from './entities/organization-document.entity';

export class OrganizationDocumentService {
  constructor(private readonly organizationDocumentRepository: OrganizationDocumentRepository) {}

  async listByOrganization(organizationId: string): Promise<OrganizationDocumentEntity[]> {
    return this.organizationDocumentRepository.findActiveByOrganization(organizationId);
  }

  // Called from AuthService.createOrganization when hasOwnFleet is false and at least one
  // document was submitted — see auth.validators.ts for the "at least one required" rule.
  async upsertDocuments(
    organizationId: string,
    actingUserId: string,
    documents: OrganizationDocumentInput[],
    manager?: EntityManager,
  ): Promise<OrganizationDocumentEntity[]> {
    return this.organizationDocumentRepository.upsert(
      organizationId,
      actingUserId,
      documents,
      manager,
    );
  }

  // Called when hasOwnFleet flips to true — mirrors the old behavior of nulling out
  // gstin/documentUrl in that case; a fleet-owning org doesn't need these documents tracked.
  async clearDocuments(
    organizationId: string,
    actingUserId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    return this.organizationDocumentRepository.softDeleteAllActive(
      organizationId,
      actingUserId,
      manager,
    );
  }

  async removeActiveDocumentType(
    organizationId: string,
    documentType: OrganizationDocumentInput['documentType'],
    actingUserId: string,
    manager?: EntityManager,
  ): Promise<void> {
    return this.organizationDocumentRepository.softDeleteActiveByType(
      organizationId,
      documentType,
      actingUserId,
      manager,
    );
  }

  async findActiveById(documentId: string): Promise<OrganizationDocumentEntity | null> {
    return this.organizationDocumentRepository.findActiveById(documentId);
  }

  // Automated IDfy verification (see OrganizationDocumentVerificationService) — remembers the
  // IDfy request_id so a retried job polls the same task instead of submitting a duplicate.
  async recordVerificationRequest(documentId: string, requestId: string): Promise<void> {
    await this.organizationDocumentRepository.updateById(documentId, {
      sourceReference: requestId,
    });
  }

  // IDfy returned the document's details — the document is valid with no admin step.
  async applyAutoVerification(
    documentId: string,
    result: { registeredName: string | null; rawResponse: Record<string, unknown> },
  ): Promise<void> {
    await this.organizationDocumentRepository.updateById(documentId, {
      verificationStatus: 'verified',
      verifiedAt: new Date(),
      ...(result.registeredName ? { registeredName: result.registeredName } : {}),
      rawResponse: result.rawResponse,
      rejectionReason: null,
      updatedBy: null,
    });
  }

  // IDfy couldn't confirm the document — stays 'pending' for admin review; only the raw
  // response is kept for the reviewer.
  async recordAutoVerificationFailure(
    documentId: string,
    rawResponse: Record<string, unknown>,
  ): Promise<void> {
    await this.organizationDocumentRepository.updateById(documentId, { rawResponse });
  }

  // Platform-admin action (PATCH /admin/organizations/:organizationId/documents/:documentId) —
  // manual override; GST/Udyam/CIN numbers are also verified automatically via IDfy.
  async updateVerificationStatus(
    organizationId: string,
    documentId: string,
    actingUserId: string,
    input: { verificationStatus: DocumentVerificationStatus; reason?: string },
  ): Promise<OrganizationDocumentEntity> {
    const document = await this.organizationDocumentRepository.findActiveById(documentId);
    if (!document || document.organizationId !== organizationId) {
      throw new NotFoundError(
        `Document ${documentId} not found for organization ${organizationId}`,
      );
    }

    const updated = await this.organizationDocumentRepository.updateVerificationStatus(documentId, {
      verificationStatus: input.verificationStatus,
      verifiedAt: input.verificationStatus === 'pending' ? null : new Date(),
      // Cleared on any status other than reject — mirrors DriverRepository.approve nulling
      // rejectionReason back out.
      rejectionReason: input.verificationStatus === 'invalid' ? (input.reason ?? null) : null,
      updatedBy: actingUserId,
    });
    if (!updated) {
      throw new NotFoundError(
        `Document ${documentId} not found for organization ${organizationId}`,
      );
    }
    return updated;
  }
}
