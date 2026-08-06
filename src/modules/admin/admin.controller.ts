import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { ListOrganizationsInput, ListStaffInput, OrganizationParams, UpdateOrganizationInput } from './utils/admin.interface';
import { CreateStaffInput } from '../auth/auth.types';
import { AdminService } from './admin.service';

export class AdminController {
  constructor(private readonly adminService: AdminService) { }

  listOrganizations = async (req: Request, res: Response) => {
    const organizations = await this.adminService.listOrganizations(req.validatedQuery as ListOrganizationsInput);
    respond(res, organizations);
  };

  getOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.getOrganization(req.params.organizationId);
    respond(res, organization);
  };

  updateOrganization = async (req: Request<OrganizationParams>, res: Response) => {
    const organization = await this.adminService.updateOrganization(
      req.params.organizationId,
      req.body as UpdateOrganizationInput,
    );
    respond(res, organization);
  };

  createStaff = async (req: Request, res: Response) => {
    const staff = await this.adminService.createStaff(req.user!, req.body as CreateStaffInput);
    respond(res, staff, 201);
  };

  listStaff = async (req: Request, res: Response) => {
    const staff = await this.adminService.listStaff(req.validatedQuery as ListStaffInput);
    respond(res, staff);
  };
}
