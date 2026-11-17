import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { LoadDocumentService } from './load-document.service';
import { DocumentReviewDecision } from './load-document.types';

type DocumentParams = { loadId: string; documentId: string };

export class LoadDocumentController {
  constructor(private readonly documents: LoadDocumentService) {}

  list = async (req: Request<{ loadId: string }>, res: Response) => {
    const { history } = (req.validatedQuery ?? {}) as { history?: boolean };
    respond(
      res,
      await this.documents.list(
        requireTenantId(req),
        req.user!.role,
        req.params.loadId,
        Boolean(history),
      ),
    );
  };

  review = async (req: Request<DocumentParams>, res: Response) => {
    const { decision, reason } = req.body as { decision: DocumentReviewDecision; reason?: string };
    respond(
      res,
      await this.documents.review(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.params.loadId,
        req.params.documentId,
        decision,
        reason,
        'shipper',
      ),
    );
  };
}
