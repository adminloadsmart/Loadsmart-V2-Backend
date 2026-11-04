import { EntityManager } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { OrganizationRepository } from './organization.repository';
import {
  OrganizationListFilters,
  OrganizationQueueSummary,
  ReferralSignupCounts,
} from './organization.types';
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

  async searchActiveByNameOrPhone(
    query: string,
    limit = 10,
  ): Promise<{ id: string; name: string }[]> {
    return this.organizationRepository.searchActiveByNameOrPhone(query, limit);
  }

  async listOrganizations(
    filters: OrganizationListFilters & { page: number; limit: number },
  ): Promise<{ items: OrganizationEntity[]; total: number }> {
    return this.organizationRepository.list(filters);
  }

  summarizeOrganizations(filters: OrganizationListFilters): Promise<OrganizationQueueSummary> {
    return this.organizationRepository.summarize(filters);
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
      seatLimit: number | null;
      lateDeliveryThresholdMinutes: number | null;
      onlineKycVerifierId: string | null;
      physicalKycAgentId: string | null;
      onlineKycCompletedAt: Date | null;
      physicalKycApprovedAt: Date | null;
      decisionReason: string | null;
      submittedAt: Date | null;
      approvedAt: Date | null;
      journeyStage: OrganizationJourneyStage | null;
    }>,
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    return this.organizationRepository.update(organizationId, data, manager);
  }

  countByReferralCodeId(referralCodeId: string): Promise<number> {
    return this.organizationRepository.countByReferralCodeId(referralCodeId);
  }

  countSignupsByReferralCodeOwnerIds(
    ownerUserIds: string[],
  ): Promise<Map<string, ReferralSignupCounts>> {
    return this.organizationRepository.countSignupsByReferralCodeOwnerIds(ownerUserIds);
  }

  countPendingKycAssignmentsByStaffIds(staffIds: string[]): Promise<Map<string, number>> {
    return this.organizationRepository.countPendingKycAssignmentsByStaffIds(staffIds);
  }
}
