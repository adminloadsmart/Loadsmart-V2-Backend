import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import {
  DriverBankDetailsParams,
  DriverDocumentParams,
  DriverParams,
  LinkParams,
  VehicleDocumentParams,
  VehicleParams,
} from './utils/masters.interface';
import { ListVehiclesInput } from './utils/vehicle.interface';
import { ListDriversInput } from './utils/drivers.interface';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetDriverLinkService } from './fleet-driver-link.service';

export class MastersController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly fleetDriverLinkService: FleetDriverLinkService,
  ) { }

  createVehicle = async (req: Request, res: Response) => {
    const vehicle = await this.vehicleService.createVehicle(requireTenantId(req), req.user!.id, req.body);
    respond(res, vehicle, 201);
  };

  listVehicles = async (req: Request, res: Response) => {
    const vehicles = await this.vehicleService.listVehicles(
      requireTenantId(req),
      req.validatedQuery as ListVehiclesInput,
    );
    respond(res, vehicles);
  };

  getVehicle = async (req: Request<VehicleParams>, res: Response) => {
    const vehicle = await this.vehicleService.getVehicle(requireTenantId(req), req.params.vehicleId);
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
    await this.vehicleService.deleteVehicle(requireTenantId(req), req.user!.id, req.params.vehicleId);
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
    const documents = await this.vehicleService.listDocuments(requireTenantId(req), req.params.vehicleId);
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

  createDriver = async (req: Request, res: Response) => {
    const driver = await this.driverService.createDriver(requireTenantId(req), req.user!.id, req.body);
    respond(res, driver, 201);
  };

  listDrivers = async (req: Request, res: Response) => {
    // `validate` middleware (masters.routes.ts) has already coerced/defaulted this against
    // mastersValidators.listDrivers before this runs — see req.validatedQuery's doc comment
    // (request.types.ts) for why it's not just req.query.
    const drivers = await this.driverService.listDrivers(
      requireTenantId(req),
      req.validatedQuery as ListDriversInput,
    );
    respond(res, drivers);
  };

  getDriver = async (req: Request<DriverParams>, res: Response) => {
    const driver = await this.driverService.getDriver(requireTenantId(req), req.params.driverId);
    respond(res, driver);
  };

  updateDriver = async (req: Request<DriverParams>, res: Response) => {
    const driver = await this.driverService.updateDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, driver);
  };

  deleteDriver = async (req: Request<DriverParams>, res: Response) => {
    await this.driverService.deleteDriver(requireTenantId(req), req.user!.id, req.params.driverId);
    respond(res, { success: true });
  };

  addDriverDocument = async (req: Request<DriverParams>, res: Response) => {
    const document = await this.driverService.addDocument(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, document, 201);
  };

  listDriverDocuments = async (req: Request<DriverParams>, res: Response) => {
    const documents = await this.driverService.listDocuments(requireTenantId(req), req.params.driverId);
    respond(res, documents);
  };

  deleteDriverDocument = async (req: Request<DriverDocumentParams>, res: Response) => {
    await this.driverService.deleteDocument(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.params.documentId,
    );
    respond(res, { success: true });
  };

  recordDriverVerification = async (req: Request<DriverParams>, res: Response) => {
    const verification = await this.driverService.recordVerification(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, verification, 201);
  };

  listDriverVerifications = async (req: Request<DriverParams>, res: Response) => {
    const verifications = await this.driverService.listVerifications(requireTenantId(req), req.params.driverId);
    respond(res, verifications);
  };

  addDriverBankDetails = async (req: Request<DriverParams>, res: Response) => {
    const bankDetails = await this.driverService.addBankDetails(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, bankDetails, 201);
  };

  listDriverBankDetails = async (req: Request<DriverParams>, res: Response) => {
    const bankDetails = await this.driverService.listBankDetails(requireTenantId(req), req.params.driverId);
    respond(res, bankDetails);
  };

  setDriverBankDetailsVerification = async (req: Request<DriverBankDetailsParams>, res: Response) => {
    const bankDetails = await this.driverService.setBankDetailsVerification(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.params.bankDetailsId,
      req.body.verificationStatus,
    );
    respond(res, bankDetails);
  };

  deleteDriverBankDetails = async (req: Request<DriverBankDetailsParams>, res: Response) => {
    await this.driverService.deleteBankDetails(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.params.bankDetailsId,
    );
    respond(res, { success: true });
  };

  linkDriver = async (req: Request<VehicleParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.linkDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.vehicleId,
      req.body,
    );
    respond(res, link, 201);
  };

  listVehicleLinks = async (req: Request<VehicleParams>, res: Response) => {
    const links = await this.fleetDriverLinkService.listVehicleLinks(requireTenantId(req), req.params.vehicleId);
    respond(res, links);
  };

  listDriverLinks = async (req: Request<DriverParams>, res: Response) => {
    const links = await this.fleetDriverLinkService.listDriverLinks(requireTenantId(req), req.params.driverId);
    respond(res, links);
  };

  setLinkPrimary = async (req: Request<LinkParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.setPrimary(requireTenantId(req), req.user!.id, req.params.linkId);
    respond(res, link);
  };

  endLink = async (req: Request<LinkParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.endLink(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
      req.body.linkedTo,
    );
    respond(res, link);
  };

  deleteLink = async (req: Request<LinkParams>, res: Response) => {
    await this.fleetDriverLinkService.deleteLink(requireTenantId(req), req.user!.id, req.params.linkId);
    respond(res, { success: true });
  };

  onboardVehicle = async (req: Request, res: Response) => {
    const vehicle = await this.vehicleService.onboardVehicle(requireTenantId(req), req.user!.id, req.body);
    respond(res, vehicle, 201);
  };

  getVehicleOperationalStatus = async (req: Request<VehicleParams>, res: Response) => {
    const status = await this.vehicleService.getOperationalStatus(requireTenantId(req), req.params.vehicleId);
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
    const meta = await this.vehicleService.getTelemetryMeta(requireTenantId(req), req.params.vehicleId);
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
    const usage = await this.vehicleService.getServiceUsage(requireTenantId(req), req.params.vehicleId);
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
    const snapshots = await this.vehicleService.listVerifications(requireTenantId(req), req.params.vehicleId);
    respond(res, snapshots);
  };

  onboardDriver = async (req: Request, res: Response) => {
    const driver = await this.driverService.onboardDriver(requireTenantId(req), req.user!.id, req.body);
    respond(res, driver, 201);
  };

  getDriverOperationalStatus = async (req: Request<DriverParams>, res: Response) => {
    const status = await this.driverService.getOperationalStatus(requireTenantId(req), req.params.driverId);
    respond(res, status);
  };

  setDriverOperationalStatus = async (req: Request<DriverParams>, res: Response) => {
    const status = await this.driverService.setOperationalStatus(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, status);
  };

  recordDriverTripMetrics = async (req: Request<DriverParams>, res: Response) => {
    const metrics = await this.driverService.recordTripMetrics(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body,
    );
    respond(res, metrics);
  };

  listDriverTripMetrics = async (req: Request<DriverParams>, res: Response) => {
    const metrics = await this.driverService.listTripMetrics(requireTenantId(req), req.params.driverId);
    respond(res, metrics);
  };
}
