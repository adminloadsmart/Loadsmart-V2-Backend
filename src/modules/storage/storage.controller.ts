import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { StorageService } from './storage.service';
import { FileParams, GenerateUploadUrlInput, GetByKeyQuery } from './storage.types';

export class StorageController {
  constructor(private readonly service: StorageService) {}

  // No requireTenantId here — a tenant-less platform-scope caller can reach this once past
  // storage.routes.ts's own permission-only gate, so tenantId is legitimately null. See
  // storage.service.ts's generateUploadUrl/confirmUpload for the tenant-less handling.
  generateUploadUrl = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.generateUploadUrl(
        req.user!.tenantId,
        req.user!.id,
        req.body as GenerateUploadUrlInput,
      ),
      201,
    );

  confirmUpload = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.confirmUpload(
        req.user!.tenantId,
        (req.params as unknown as FileParams).fileId,
      ),
    );

  // No requireTenantId here — this route sits behind requirePermission only (not requireTenant),
  // so req.user.tenantId is legitimately null for a platform-scope caller. See storage.service.ts.
  get = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.get(
        { tenantId: req.user!.tenantId, role: req.user!.role },
        (req.params as unknown as FileParams).fileId,
      ),
    );

  // Reads req.validatedQuery, not req.query — see validate.middleware.ts (req.query has no
  // setter in Express 5, so the validated/coerced query is stashed there instead).
  getByKey = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.getByKey(
        { tenantId: req.user!.tenantId, role: req.user!.role },
        (req.validatedQuery as GetByKeyQuery).key,
      ),
    );

  remove = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.remove(requireTenantId(req), (req.params as unknown as FileParams).fileId),
    );
}
