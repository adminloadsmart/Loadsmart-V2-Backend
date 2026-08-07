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

  // Soft-deletes any existing active row for this (organizationId, documentType), then inserts a
  // fresh 'pending' one per submitted document — used on both first-time signup and later profile
  // resubmission, so a resubmit always starts a new verification cycle rather than mutating
  // whatever an admin may have already reviewed.
  async replace(
    organizationId: string,
    actingUserId: string,
    documents: OrganizationDocumentInput[],
    manager?: EntityManager,
  ): Promise<OrganizationDocumentEntity[]> {
    const repo = manager ? manager.getRepository(OrganizationDocumentEntity) : this.repo;

    for (const document of documents) {
      await repo.update(
        { organizationId, documentType: document.documentType, deletedAt: IsNull() },
        { deletedAt: new Date(), updatedBy: actingUserId },
      );
    }

    const rows = repo.create(
      documents.map((document) => ({
        organizationId,
        documentType: document.documentType,
        documentNumber: document.documentNumber ?? null,
        fileKey: document.fileKey ?? null,
        registeredName: document.registeredName ?? null,
        dob: document.dob ?? null,
        addressLine1: document.addressLine1 ?? null,
        addressLine2: document.addressLine2 ?? null,
        city: document.city ?? null,
        district: document.district ?? null,
        state: document.state ?? null,
        pinCode: document.pinCode ?? null,
        verificationStatus: 'pending' as DocumentVerificationStatus,
        createdBy: actingUserId,
      })),
    );
    return repo.save(rows);
  }

  // Soft-deletes every active document for the org — used when hasOwnFleet flips to true, mirroring
  // the old behavior of nulling out gstin/documentUrl in that case.
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
      updatedBy: string;
    },
  ): Promise<OrganizationDocumentEntity | null> {
    await this.repo.update({ id }, data);
    return this.findActiveById(id);
  }
}
