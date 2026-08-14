import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { AuthService } from '../auth/auth.service';
import { InviteOrganizationUserInput, ListOrganizationUsersInput } from '../auth/auth.types';
import { SaveShopboardPremisesPhotoInput } from './organization.types';

// The org onboarding endpoints — GET/POST /auth/organization, POST /auth/organization/business,
// POST /auth/organization/submit. Kept mounted under /auth (see modules/organization/index.ts's
// createOrganizationOnboardingRoutes) since these URLs are unchanged, but the controller itself
// belongs here, not in modules/auth/, since it's org-owned API surface. Delegates straight to
// AuthService — creating/submitting an org also mutates the caller's own session (tenantId +
// token pair on first-time creation), so AuthService keeps owning that orchestration; this
// controller just calls it, the same "read another module's service directly, no gateway"
// pattern modules/admin/ already uses for authService.getUserById/createStaffUser/listStaffUsers.
export class OrganizationController {
  constructor(private readonly authService: AuthService) {}

  getOrganization = async (req: Request, res: Response) => {
    if (!req.user!.tenantId) {
      respond(res, null); // hasn't completed their company profile yet — no organization exists
      return;
    }
    const organization = await this.authService.getOrganization(req.user!.tenantId);
    respond(res, organization);
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
    const result = await this.authService.saveBusinessDetails(req.user!, req.body);
    respond(res, result);
  };

  submitOrganization = async (req: Request, res: Response) => {
    const result = await this.authService.submitOrganization(req.user!, req.body);
    respond(res, result);
  };

  saveShopboardPremisesPhoto = async (req: Request, res: Response) => {
    const result = await this.authService.saveShopboardPremisesPhoto(
      req.user!,
      req.body as SaveShopboardPremisesPhotoInput,
      req.file!,
    );
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

  listAssignableRoles = async (_req: Request, res: Response) => {
    const roles = await this.authService.listAssignableOrganizationRoles();
    respond(res, roles);
  };
}
