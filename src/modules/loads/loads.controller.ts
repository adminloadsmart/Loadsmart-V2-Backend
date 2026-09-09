import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { RequisitionService } from './requisition.service';
import { DispatchPlanningService } from './dispatch-planning.service';
import { LoadService } from './load.service';
import { LoadPaymentService } from './load-payment.service';
import { LoadActivityService } from './load-activity.service';
import {
  CreateRequisitionInput,
  ListRequisitionsInput,
  RequisitionParams,
} from './utils/requisition.interface';
import { ListVehiclesInput } from '../masters/vehicle/vehicle.interface';
import { PlanDispatchInput } from './utils/dispatch-planning.interface';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  ListLoadsInput,
  LoadParams,
  UpdateLoadStatusInput,
  UploadPodInput,
} from './utils/load.interface';
import { RecordAdvanceInput, RecordBalanceInput } from './utils/load-payment.interface';

export class LoadsController {
  constructor(
    private readonly requisitionService: RequisitionService,
    private readonly dispatchPlanningService: DispatchPlanningService,
    private readonly loadService: LoadService,
    private readonly loadPaymentService: LoadPaymentService,
    private readonly loadActivityService: LoadActivityService,
  ) {}

  // --- Requisitions ---

  createRequisition = async (req: Request, res: Response) => {
    const requisition = await this.requisitionService.create(
      requireTenantId(req),
      req.user!.id,
      req.body as CreateRequisitionInput,
    );
    respond(res, requisition, 201);
  };

  listRequisitions = async (req: Request, res: Response) => {
    const requisitions = await this.requisitionService.list(
      requireTenantId(req),
      req.validatedQuery as ListRequisitionsInput,
    );
    respond(res, requisitions);
  };

  getRequisition = async (req: Request<RequisitionParams>, res: Response) => {
    const result = await this.requisitionService.get(
      requireTenantId(req),
      req.params.requisitionId,
    );
    respond(res, result);
  };

  closeRequisition = async (req: Request<RequisitionParams>, res: Response) => {
    const requisition = await this.requisitionService.close(
      requireTenantId(req),
      req.user!.id,
      req.params.requisitionId,
      (req.body as { reason: string }).reason,
    );
    respond(res, requisition);
  };

  deleteRequisition = async (req: Request<RequisitionParams>, res: Response) => {
    await this.requisitionService.delete(
      requireTenantId(req),
      req.user!.id,
      req.params.requisitionId,
    );
    respond(res, { success: true });
  };

  // --- Dispatch Planning ---

  planDispatch = async (req: Request<RequisitionParams>, res: Response) => {
    const result = await this.dispatchPlanningService.planDispatch(
      requireTenantId(req),
      req.user!.id,
      req.params.requisitionId,
      req.body as PlanDispatchInput,
    );
    respond(res, result, 201);
  };

  listAvailableVehicles = async (req: Request<RequisitionParams>, res: Response) => {
    const result = await this.dispatchPlanningService.listAvailableVehicles(
      requireTenantId(req),
      req.params.requisitionId,
      req.validatedQuery as ListVehiclesInput,
    );
    respond(res, result);
  };

  // --- Loads ---

  listLoads = async (req: Request, res: Response) => {
    const loads = await this.loadService.list(
      requireTenantId(req),
      req.validatedQuery as ListLoadsInput,
    );
    respond(res, loads);
  };

  getLoad = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.loadService.get(
      requireTenantId(req),
      req.user!.role,
      req.params.loadId,
    );
    respond(res, result);
  };

  assignLoad = async (req: Request<LoadParams>, res: Response) => {
    const result = await this.loadService.assign(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as AssignLoadInput,
    );
    respond(res, result);
  };

  confirmLoading = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.confirmLoading(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.params.loadId,
      req.body as ConfirmLoadingInput,
    );
    respond(res, load);
  };

  updateLoadStatus = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.updateStatus(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      (req.body as UpdateLoadStatusInput).toStatus,
    );
    respond(res, load);
  };

  uploadPod = async (req: Request<LoadParams>, res: Response) => {
    const load = await this.loadService.uploadPod(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.params.loadId,
      req.body as UploadPodInput,
    );
    respond(res, load);
  };

  listLoadActivities = async (req: Request<LoadParams>, res: Response) => {
    const activities = await this.loadActivityService.listByLoad(
      requireTenantId(req),
      req.params.loadId,
    );
    respond(res, activities);
  };

  // --- Payments ---

  recordAdvancePayment = async (req: Request<LoadParams>, res: Response) => {
    const payment = await this.loadPaymentService.recordAdvance(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as RecordAdvanceInput,
    );
    respond(res, payment, 201);
  };

  recordBalancePayment = async (req: Request<LoadParams>, res: Response) => {
    const payment = await this.loadPaymentService.recordBalance(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as RecordBalanceInput,
    );
    respond(res, payment, 201);
  };

  listLoadPayments = async (req: Request<LoadParams>, res: Response) => {
    const payments = await this.loadPaymentService.listByLoad(
      requireTenantId(req),
      req.params.loadId,
    );
    respond(res, payments);
  };
}
