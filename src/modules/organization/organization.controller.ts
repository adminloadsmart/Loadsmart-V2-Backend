import { Request, Response } from 'express';
import { AuthorizationError } from '../../shared/errors';
import { respond } from '../../shared/responses/respond';
import { AuthService } from '../auth/auth.service';
import {
  ChangeOrganizationUserSeatInput,
  InviteOrganizationUserInput,
  ListOrganizationUsersInput,
} from '../auth/auth.types';
import { sendCsv } from '../../shared/utils/csv';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { OrganizationSettingsService } from './organization-settings.service';

// The org onboarding endpoints — GET/POST /auth/organization, POST /auth/organization/business,
// POST /auth/organization/submit. Kept mounted under /auth (see modules/organization/index.ts's
// createOrganizationOnboardingRoutes) since these URLs are unchanged, but the controller itself
// belongs here, not in modules/auth/, since it's org-owned API surface. Delegates straight to
// AuthService — creating/submitting an org also mutates the caller's own session (tenantId +
// token pair on first-time creation), so AuthService keeps owning that orchestration; this
// controller just calls it, the same "read another module's service directly, no gateway"
// pattern modules/admin/ already uses for authService.getUserById/createStaffUser/listStaffUsers.
export class OrganizationController {
  constructor(
    private readonly authService: AuthService,
    private readonly settingsService: OrganizationSettingsService,
  ) {}

  getLateDeliverySetting = async (req: Request, res: Response) =>
    respond(res, await this.settingsService.getLateDelivery(requireTenantId(req)));

  updateLateDeliverySetting = async (req: Request, res: Response) =>
    respond(
      res,
      await this.settingsService.updateLateDelivery(
        requireTenantId(req),
        req.user!.id,
        (req.body as { thresholdMinutes: number | null }).thresholdMinutes,
      ),
    );

  getOrganization = async (req: Request, res: Response) => {
    const organization = await this.authService.getOrganizationForUser(req.user!);
    respond(res, organization);
  };

  getBusinessDetails = async (req: Request, res: Response) => {
    if (!req.user?.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }
    const businessDetails = await this.authService.getBusinessDetails(req.user.tenantId);
    respond(res, businessDetails);
  };

  createOrganization = async (req: Request, res: Response) => {
    const result = await this.authService.createOrganization(
      req.user!.id,
      req.user!.tenantId,
      req.body,
    );
    respond(res, result);
  };

  saveBusinessDetails = async (req: Request, res: Response) => {
    const files = (req.files ?? {}) as {
      documentFront?: Express.Multer.File[];
      shopPremisesPhoto?: Express.Multer.File[];
    };
    const documentFrontKeys = req.body.documentFront
      ? Array.isArray(req.body.documentFront)
        ? req.body.documentFront
        : [req.body.documentFront]
      : [];
    const result = await this.authService.saveBusinessDetails(req.user!, req.body, {
      documentFront: files.documentFront ?? [],
      shopPremisesPhoto: files.shopPremisesPhoto?.[0],
      documentFrontKeys,
      shopPremisesPhotoKey: req.body.shopPremisesPhoto,
    });
    respond(res, result);
  };

  submitOrganization = async (req: Request, res: Response) => {
    const result = await this.authService.submitOrganization(req.user!, req.body);
    respond(res, result);
  };

  inviteUser = async (req: Request, res: Response) => {
    const user = await this.authService.inviteOrganizationUser(
      req.user!,
      req.body as InviteOrganizationUserInput,
    );
    respond(res, user, 201);
  };

  listUsers = async (req: Request, res: Response) => {
    const users = await this.authService.listOrganizationUsers(
      req.user!,
      req.validatedQuery as ListOrganizationUsersInput,
    );
    respond(res, users);
  };

  usersSummary = async (req: Request, res: Response) =>
    respond(res, await this.authService.organizationUsersSummary(req.user!));

  exportUsers = async (req: Request, res: Response) =>
    sendCsv(
      res,
      'users',
      await this.authService.exportOrganizationUsers(
        req.user!,
        req.validatedQuery as Omit<ListOrganizationUsersInput, 'page' | 'limit'>,
      ),
    );

  changeUserSeat = async (req: Request, res: Response) =>
    respond(
      res,
      await this.authService.changeOrganizationUserSeat(
        req.user!,
        String(req.params.userId),
        req.body as ChangeOrganizationUserSeatInput,
      ),
    );

  removeUser = async (req: Request, res: Response) => {
    await this.authService.removeOrganizationUser(req.user!, String(req.params.userId));
    respond(res, { success: true });
  };

  listSeats = async (req: Request, res: Response) =>
    respond(res, await this.authService.listOrganizationSeats(req.user!));

  listAssignableRoles = async (_req: Request, res: Response) => {
    const roles = await this.authService.listAssignableOrganizationRoles();
    respond(res, roles);
  };
}
