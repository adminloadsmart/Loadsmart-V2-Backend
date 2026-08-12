import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { StaffImportService } from './staff-import.service';
import { StaffImportParams } from './staff-import.types';

export class StaffImportController {
  constructor(private readonly service: StaffImportService) {}
  preview = async (req: Request, res: Response) =>
    respond(res, await this.service.preview(req.user!, req.file!));
  commit = async (req: Request, res: Response) =>
    respond(res, await this.service.commit(req.user!, req.body.importId));
  get = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.get(req.user!, (req.params as unknown as StaffImportParams).importId),
    );
}
