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

  // Platform-admin action (PATCH /admin/organizations/:organizationId/documents/:documentId) —
  // the only place a document's verificationStatus can be changed today (no automated gov-API
  // verification wired up yet).
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
