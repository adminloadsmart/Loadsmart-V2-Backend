import { DataSource } from 'typeorm';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import { OrganizationDocumentRepository } from './organization-document.repository';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { OrganizationJourneyStageHistoryRepository } from './organization-journey-stage-history.repository';
import { OrganizationJourneyStageService } from './organization-journey-stage.service';
import { ReferralCodeRepository } from './referral-code.repository';
import { ReferralCodeService } from './referral-code.service';
import { OrganizationController } from './organization.controller';
import { createOrganizationOnboardingRoutes as buildOnboardingRouter } from './organization.routes';
import { AuthService } from '../auth/auth.service';

// Owns the organization/organization-document/referral-code schema end to end: entities,
// repositories, services, and (see createOrganizationOnboardingRoutes below) the onboarding HTTP
// surface. No router/controller built here though — unlike every other create*Module factory,
// this one only builds services. The router is wired up by a second factory below, called later
// from composition-root.ts once auth.service exists (the onboarding endpoints delegate their
// orchestration to AuthService, since creating/submitting an org also mutates the caller's own
// session — tenantId + token pair on first-time creation).
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

  const organizationJourneyStageHistoryRepository = new OrganizationJourneyStageHistoryRepository(
    dataSource,
  );
  const organizationJourneyStageService = new OrganizationJourneyStageService(
    organizationService,
    organizationJourneyStageHistoryRepository,
  );

  const referralCodeRepository = new ReferralCodeRepository(dataSource);
  const referralCodeService = new ReferralCodeService(referralCodeRepository);

  return {
    organizationService,
    organizationDocumentService,
    organizationOnboardingService,
    organizationJourneyStageService,
    referralCodeService,
  };
}

// Builds the org onboarding router (GET/POST /auth/organization*) — kept separate from
// createOrganizationModule above since it depends on authService, which composition-root only
// has available after modules/auth/ itself has been built (which in turn depends on this
// module's createOrganizationModule output). Mounted at '/auth' by composition-root.ts alongside
// auth's own protectedRouter — see organization.routes.ts for why the URLs stay unchanged.
export function createOrganizationOnboardingRoutes(authService: AuthService) {
  const controller = new OrganizationController(authService);
  const router = buildOnboardingRouter(controller);
  return { router };
}
