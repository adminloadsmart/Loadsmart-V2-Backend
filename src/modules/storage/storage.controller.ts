import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { StorageService } from './storage.service';
import { FileParams, GenerateUploadUrlInput } from './storage.types';

export class StorageController {
  constructor(private readonly service: StorageService) {}

  generateUploadUrl = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.generateUploadUrl(
        requireTenantId(req),
        req.user!.id,
        req.body as GenerateUploadUrlInput,
      ),
      201,
    );

  confirmUpload = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.confirmUpload(
        requireTenantId(req),
        (req.params as unknown as FileParams).fileId,
      ),
    );

  // No requireTenantId here — this route sits behind requirePermission only (not requireTenant),
  // so req.user.tenantId is legitimately null for a platform_admin caller. See storage.service.ts.
  get = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.get(
        { tenantId: req.user!.tenantId, role: req.user!.role },
        (req.params as unknown as FileParams).fileId,
      ),
    );

  remove = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.remove(requireTenantId(req), (req.params as unknown as FileParams).fileId),
    );
}
