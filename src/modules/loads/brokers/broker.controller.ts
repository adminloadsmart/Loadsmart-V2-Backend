import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { BrokerDetailService } from './broker-detail.service';
import { BrokerService } from './broker.service';
import type {
  AddBrokerNoteInput,
  BrokerDocumentInput,
  BrokerFilters,
  ListBrokersQuery,
  UpdateBrokerInput,
} from './broker.validators';

type BrokerParams = { brokerId: string };
type DocumentParams = BrokerParams & { documentId: string };

export class BrokerController {
  constructor(
    private readonly brokers: BrokerService,
    private readonly brokerDetail: BrokerDetailService,
  ) {}

  list = async (req: Request, res: Response) => {
    respond(res, await this.brokers.list(req.validatedQuery as ListBrokersQuery));
  };

  exportCsv = async (req: Request, res: Response) => {
    const csv = await this.brokers.exportCsv(req.validatedQuery as BrokerFilters);
    res
      .status(200)
      .type('text/csv')
      .attachment(`brokers-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(csv);
  };

  /** One broker's page. */
  detail = async (req: Request<BrokerParams>, res: Response) => {
    respond(res, await this.brokerDetail.detail(req.params.brokerId));
  };

  update = async (req: Request<BrokerParams>, res: Response) => {
    respond(
      res,
      await this.brokerDetail.update(req.user!, req.params.brokerId, req.body as UpdateBrokerInput),
    );
  };

  addNote = async (req: Request<BrokerParams>, res: Response) => {
    respond(
      res,
      await this.brokerDetail.addNote(
        req.user!.id,
        req.params.brokerId,
        req.body as AddBrokerNoteInput,
      ),
      201,
    );
  };

  addDocument = async (req: Request<BrokerParams>, res: Response) => {
    respond(
      res,
      await this.brokerDetail.addDocument(
        req.user!.id,
        req.params.brokerId,
        req.body as BrokerDocumentInput,
      ),
      201,
    );
  };

  updateDocument = async (req: Request<DocumentParams>, res: Response) => {
    respond(
      res,
      await this.brokerDetail.updateDocument(
        req.user!.id,
        req.params.brokerId,
        req.params.documentId,
        req.body as BrokerDocumentInput,
      ),
    );
  };

  deleteDocument = async (req: Request<DocumentParams>, res: Response) => {
    await this.brokerDetail.deleteDocument(
      req.user!.id,
      req.params.brokerId,
      req.params.documentId,
    );
    res.status(204).end();
  };
}
