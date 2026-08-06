import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { RoleService } from './role.service';

export class RoleController {
    constructor(private readonly roleService: RoleService) { }

    listRoles = async (req: Request, res: Response) => {
        const roles = await this.roleService.listRoles(req.user!, req.validatedQuery as { scope?: 'platform' | 'organization' });
        respond(res, roles);
    };

    listPermissions = async (req: Request, res: Response) => {
        const permissions = await this.roleService.listPermissions(req.user!, req.validatedQuery as { scope?: 'platform' | 'organization' });
        respond(res, permissions);
    };

    getUserPermissions = async (req: Request<{ userId: string }>, res: Response) => {
        const permissions = await this.roleService.getUserPermissions(req.user!, req.params.userId);
        respond(res, permissions);
    };

    assignRole = async (req: Request<{ userId: string }>, res: Response) => {
        const role = await this.roleService.assignRole(req.user!, req.params.userId, req.body.roleId);
        respond(res, role);
    };

    grantPermission = async (req: Request<{ userId: string }>, res: Response) => {
        const permission = await this.roleService.grantPermission(req.user!, req.params.userId, req.body.permissionId);
        respond(res, permission, 201);
    };

    revokePermission = async (req: Request<{ userId: string; permissionId: string }>, res: Response) => {
        await this.roleService.revokePermission(req.user!, req.params.userId, req.params.permissionId);
        respond(res, { success: true });
    };
}
