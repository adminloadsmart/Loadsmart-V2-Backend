import { EntityManager } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { OrganizationRepository } from './organization.repository';
import { GstinVerificationStatus, OrganizationEntity, OrganizationStatus } from './entities/organization.entity';

interface CreateOrganizationInput {
    name: string | null;
    status?: OrganizationStatus;
}

export class OrganizationService {
    constructor(private readonly organizationRepository: OrganizationRepository) { }

    async createOrganization(input: CreateOrganizationInput, manager?: EntityManager): Promise<OrganizationEntity> {
        const { name, status } = input;
        return this.organizationRepository.create(name, status, manager);
    }

    async getOrganizationStatus(organizationId: string): Promise<OrganizationEntity> {
        const organization = await this.organizationRepository.findById(organizationId);
        if (!organization) throw new NotFoundError(`Organization ${organizationId} not found`);
        return organization;
    }

    async listOrganizations(filters: {
        status?: OrganizationStatus;
        search?: string;
        page: number;
        limit: number;
    }): Promise<{ items: OrganizationEntity[]; total: number }> {
        return this.organizationRepository.list(filters);
    }

    async updateOrganization(
        organizationId: string,
        data: Partial<{
            name: string;
            status: OrganizationStatus;
            companyLegalName: string | null;
            orgAdminName: string | null;
            operationalCity: string | null;
            addressLine1: string | null;
            addressLine2: string | null;
            city: string | null;
            district: string | null;
            state: string | null;
            hasOwnFleet: boolean | null;
            fleetSize: number | null;
            gstin: string | null;
            gstinVerificationStatus: GstinVerificationStatus | null;
            documentUrl: string | null;
        }>,
        manager?: EntityManager,
    ): Promise<OrganizationEntity> {
        return this.organizationRepository.update(organizationId, data, manager);
    }
}
