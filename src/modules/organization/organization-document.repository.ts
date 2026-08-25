import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  DocumentVerificationStatus,
  OrganizationDocumentEntity,
  OrganizationDocumentInput,
} from './entities/organization-document.entity';

export class OrganizationDocumentRepository {
  private readonly repo: Repository<OrganizationDocumentEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(OrganizationDocumentEntity);
  }

  async findActiveByOrganization(organizationId: string): Promise<OrganizationDocumentEntity[]> {
    return this.repo.find({
      where: { organizationId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  async findActiveById(id: string): Promise<OrganizationDocumentEntity | null> {
    return this.repo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  async findActiveByOrganizationAndType(
    organizationId: string,
    documentType: OrganizationDocumentInput['documentType'],
    manager?: EntityManager,
  ): Promise<OrganizationDocumentEntity | null> {
    const repo = manager ? manager.getRepository(OrganizationDocumentEntity) : this.repo;
    return repo.findOne({ where: { organizationId, documentType, deletedAt: IsNull() } });
  }

  // Upserts a document type for an organization, preserving a single active row per type.
  // This keeps the API idempotent while avoiding duplicate documents during repeated saves.
  async upsert(
    organizationId: string,
    actingUserId: string,
    documents: OrganizationDocumentInput[],
    manager?: EntityManager,
  ): Promise<OrganizationDocumentEntity[]> {
    const repo = manager ? manager.getRepository(OrganizationDocumentEntity) : this.repo;

    const saved: OrganizationDocumentEntity[] = [];
    for (const document of documents) {
      const documentUrls =
        document.documentUrls ?? (document.documentUrl ? [document.documentUrl] : []);
      const existing = await this.findActiveByOrganizationAndType(
        organizationId,
        document.documentType,
        manager,
      );
      if (existing) {
        // A file-only re-upload may omit the document number. Keep the previously submitted
        // number instead of erasing it during replacement.
        existing.documentNumber = document.documentNumber ?? existing.documentNumber;
        existing.fileKey = documentUrls[0] ?? null;
        existing.fileKeys = documentUrls.length ? documentUrls : null;
        existing.backFileKey = null;
        existing.addressLine1 =
          document.registeredAddress?.addressLine1 ?? existing.addressLine1 ?? null;
        existing.addressLine2 =
          document.registeredAddress?.addressLine2 ?? existing.addressLine2 ?? null;
        existing.city = document.registeredAddress?.city ?? existing.city ?? null;
        existing.state = document.registeredAddress?.state ?? existing.state ?? null;
        existing.pinCode = document.registeredAddress?.pinCode ?? existing.pinCode ?? null;
        existing.verificationStatus = 'pending' as DocumentVerificationStatus;
        existing.verifiedAt = null;
        existing.updatedBy = actingUserId;
        saved.push(await repo.save(existing));
        continue;
      }

      const row = repo.create({
        organizationId,
        documentType: document.documentType,
        documentNumber: document.documentNumber ?? null,
        fileKey: documentUrls[0] ?? null,
        fileKeys: documentUrls.length ? documentUrls : null,
        backFileKey: null,
        addressLine1: document.registeredAddress?.addressLine1 ?? null,
        addressLine2: document.registeredAddress?.addressLine2 ?? null,
        city: document.registeredAddress?.city ?? null,
        state: document.registeredAddress?.state ?? null,
        pinCode: document.registeredAddress?.pinCode ?? null,
        verificationStatus: 'pending' as DocumentVerificationStatus,
        createdBy: actingUserId,
        updatedBy: actingUserId,
      });
      saved.push(await repo.save(row));
    }

    return saved;
  }

  // Soft-deletes every active document for the org — used when the user switches back to
  // a fleet-owned company and documents are no longer required.
  async softDeleteAllActive(
    organizationId: string,
    actingUserId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(OrganizationDocumentEntity) : this.repo;
    await repo.update(
      { organizationId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: actingUserId },
    );
  }

  async updateVerificationStatus(
    id: string,
    data: {
      verificationStatus: DocumentVerificationStatus;
      verifiedAt: Date | null;
      rejectionReason: string | null;
      updatedBy: string;
    },
  ): Promise<OrganizationDocumentEntity | null> {
    await this.repo.update({ id }, data);
    return this.findActiveById(id);
  }

  async softDeleteActiveByType(
    organizationId: string,
    documentType: OrganizationDocumentInput['documentType'],
    actingUserId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(OrganizationDocumentEntity) : this.repo;
    await repo.update(
      { organizationId, documentType, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: actingUserId },
    );
  }
}
