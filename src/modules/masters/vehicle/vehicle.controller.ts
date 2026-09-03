import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import {
  ListComplianceAlertsInput,
  ListVehiclesInput,
  VehicleDocumentParams,
  VehicleParams,
} from './vehicle.interface';
import { VehicleService } from './vehicle.service';

export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  listVehicles = async (req: Request, res: Response) => {
    const vehicles = await this.vehicleService.listVehicles(
      requireTenantId(req),
      req.validatedQuery as ListVehiclesInput,
    );
    respond(res, vehicles);
  };

  getVehicle = async (req: Request<VehicleParams>, res: Response) => {
    const vehicle = await this.vehicleService.getVehicle(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, vehicle);
  };

  updateVehicle = async (req: Request<VehicleParams>, res: Response) => {
    const vehicle = await this.vehicleService.updateVehicle(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, vehicle);
  };

  deleteVehicle = async (req: Request<VehicleParams>, res: Response) => {
    await this.vehicleService.deleteVehicle(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
    );
    respond(res, { success: true });
  };

  addVehicleDocument = async (req: Request<VehicleParams>, res: Response) => {
    const document = await this.vehicleService.addDocument(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, document, 201);
  };

  listVehicleDocuments = async (req: Request<VehicleParams>, res: Response) => {
    const documents = await this.vehicleService.listDocuments(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, documents);
  };

  updateVehicleDocument = async (req: Request<VehicleDocumentParams>, res: Response) => {
    const document = await this.vehicleService.updateDocument(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.params.documentId,
      req.body,
    );
    respond(res, document);
  };

  deleteVehicleDocument = async (req: Request<VehicleDocumentParams>, res: Response) => {
    await this.vehicleService.deleteDocument(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.params.documentId,
    );
    respond(res, { success: true });
  };

  onboardVehicle = async (req: Request, res: Response) => {
    const vehicle = await this.vehicleService.onboardVehicle(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.body,
    );
    respond(res, vehicle, 201);
  };

  approveVehicle = async (req: Request<VehicleParams>, res: Response) => {
    const vehicle = await this.vehicleService.approveVehicle(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
    );
    respond(res, vehicle);
  };

  rejectVehicle = async (req: Request<VehicleParams>, res: Response) => {
    const vehicle = await this.vehicleService.rejectVehicle(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body.reason,
    );
    respond(res, vehicle);
  };

  getVehicleOperationalStatus = async (req: Request<VehicleParams>, res: Response) => {
    const status = await this.vehicleService.getOperationalStatus(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, status);
  };

  setVehicleOperationalStatus = async (req: Request<VehicleParams>, res: Response) => {
    const status = await this.vehicleService.setOperationalStatus(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, status);
  };

  getVehicleTelemetryMeta = async (req: Request<VehicleParams>, res: Response) => {
    const meta = await this.vehicleService.getTelemetryMeta(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, meta);
  };

  setVehicleTelemetryMeta = async (req: Request<VehicleParams>, res: Response) => {
    const meta = await this.vehicleService.setTelemetryMeta(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, meta);
  };

  getVehicleServiceUsage = async (req: Request<VehicleParams>, res: Response) => {
    const usage = await this.vehicleService.getServiceUsage(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, usage);
  };

  setVehicleServiceUsage = async (req: Request<VehicleParams>, res: Response) => {
    const usage = await this.vehicleService.setServiceUsage(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, usage);
  };

  recordVehicleVerification = async (req: Request<VehicleParams>, res: Response) => {
    const snapshot = await this.vehicleService.recordVerification(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, snapshot, 201);
  };

  listVehicleVerifications = async (req: Request<VehicleParams>, res: Response) => {
    const snapshots = await this.vehicleService.listVerifications(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, snapshots);
  };

  /** Fleet-wide compliance alerts (documents expired or about to expire) — feeds the Home
   *  dashboard's Compliance widget. */
  listComplianceAlerts = async (req: Request, res: Response) => {
    const alerts = await this.vehicleService.listComplianceAlerts(
      requireTenantId(req),
      req.validatedQuery as ListComplianceAlertsInput,
    );
    respond(res, alerts);
  };
}
