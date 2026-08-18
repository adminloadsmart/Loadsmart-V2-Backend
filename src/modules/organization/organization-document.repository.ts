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
      const existing = await this.findActiveByOrganizationAndType(
        organizationId,
        document.documentType,
        manager,
      );
      if (existing) {
        existing.documentNumber = document.documentNumber ?? null;
        existing.fileKey = document.documentUrl ?? null;
        existing.backFileKey = document.backFileKey ?? null;
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
        fileKey: document.documentUrl ?? null,
        backFileKey: document.backFileKey ?? null,
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
}
