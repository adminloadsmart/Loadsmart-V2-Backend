import { EntityManager } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { DateFilter } from '../../shared/utils/date-filter';
import { OrganizationRepository } from './organization.repository';
import {
  OrganizationEntity,
  OrganizationJourneyStage,
  OrganizationOnboardingStep,
  OrganizationStatus,
} from './entities/organization.entity';

interface CreateOrganizationInput {
  name: string | null;
  status?: OrganizationStatus;
}

export class OrganizationService {
  constructor(private readonly organizationRepository: OrganizationRepository) {}

  async createOrganization(
    input: CreateOrganizationInput,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const { name, status } = input;
    return this.organizationRepository.create(name, status, manager);
  }

  async getOrganizationStatus(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const organization = await this.organizationRepository.findById(organizationId, manager);
    if (!organization) throw new NotFoundError(`Organization ${organizationId} not found`);
    return organization;
  }

  async listOrganizations(filters: {
    status?: OrganizationStatus;
    journeyStage?: OrganizationJourneyStage;
    search?: string;
    filter?: DateFilter;
    from?: string;
    to?: string;
    page: number;
    limit: number;
    // Role-scoping for online_kyc_desk/offline_kyc_desk — see AdminService.listOrganizations,
    // which is the only caller that ever sets these (platform_admin's calls leave them undefined).
    onlineKycVerifierId?: string;
    physicalKycAgentId?: string;
    onlineKycCompleted?: boolean;
  }): Promise<{ items: OrganizationEntity[]; total: number }> {
    return this.organizationRepository.list(filters);
  }

  async updateOrganization(
    organizationId: string,
    data: Partial<{
      name: string;
      status: OrganizationStatus;
      companyLegalName: string | null;
      registeredBusinessName: string | null;
      orgAdminName: string | null;
      operationalCity: string | null;
      referralCodeId: string | null;
      onboardingStep: OrganizationOnboardingStep | null;
      shopboardPremisesPhotoKey: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      landmark: string | null;
      areaLocality: string | null;
      city: string | null;
      district: string | null;
      state: string | null;
      pinCode: string | null;
      hasOwnFleet: boolean | null;
      onlineKycVerifierId: string | null;
      physicalKycAgentId: string | null;
      onlineKycCompletedAt: Date | null;
      physicalKycApprovedAt: Date | null;
      decisionReason: string | null;
      submittedAt: Date | null;
      journeyStage: OrganizationJourneyStage | null;
    }>,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    return this.organizationRepository.update(organizationId, data, manager);
  }

  countByReferralCodeId(referralCodeId: string): Promise<number> {
    return this.organizationRepository.countByReferralCodeId(referralCodeId);
  }

  countActiveByReferralCodeOwnerIds(ownerUserIds: string[]): Promise<Map<string, number>> {
    return this.organizationRepository.countActiveByReferralCodeOwnerIds(ownerUserIds);
  }

  countPendingKycAssignmentsByStaffIds(staffIds: string[]): Promise<Map<string, number>> {
    return this.organizationRepository.countPendingKycAssignmentsByStaffIds(staffIds);
  }
}
