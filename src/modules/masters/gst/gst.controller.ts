import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { GstVerificationService } from './gst.service';
import { VerifyGstInput } from './gst.types';

export class GstController {
  constructor(private readonly service: GstVerificationService) {}

  verify = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.verify(requireTenantId(req), req.user!.id, req.body as VerifyGstInput),
    );
}
