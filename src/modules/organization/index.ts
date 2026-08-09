import { DataSource } from 'typeorm';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import { OrganizationDocumentRepository } from './organization-document.repository';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { ReferralCodeRepository } from './referral-code.repository';
import { ReferralCodeService } from './referral-code.service';

// Owns the organization/organization-document/referral-code schema end to end: entities,
// repositories, and services. No router/controller here, unlike every other create*Module
// factory — the onboarding HTTP surface (GET/POST /auth/organization*) deliberately stays owned
// by modules/auth/ (see auth.service.ts), since creating/submitting an organization is
// inseparable from mutating the caller's own session (tenantId + token pair). This module only
// owns the org data and the onboarding state machine (organizationOnboardingService) that
// auth.service.ts calls into.
export function createOrganizationModule(dataSource: DataSource) {
  const organizationRepository = new OrganizationRepository(dataSource);
  const organizationService = new OrganizationService(organizationRepository);

  const organizationDocumentRepository = new OrganizationDocumentRepository(dataSource);
  const organizationDocumentService = new OrganizationDocumentService(
    organizationDocumentRepository,
  );

  const organizationOnboardingService = new OrganizationOnboardingService(
    organizationService,
    organizationDocumentService,
  );

  const referralCodeRepository = new ReferralCodeRepository(dataSource);
  const referralCodeService = new ReferralCodeService(referralCodeRepository);

  return {
    organizationService,
    organizationDocumentService,
    organizationOnboardingService,
    referralCodeService,
  };
}
