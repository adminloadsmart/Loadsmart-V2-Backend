import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import {
  DriverBankDetailsParams,
  DriverDocumentParams,
  DriverParams,
  LinkParams,
  TruckTypeParams,
  VehicleDocumentParams,
  VehicleParams,
} from './utils/masters.interface';
import { ListComplianceAlertsInput, ListVehiclesInput } from './utils/vehicle.interface';
import { ListDriversInput } from './utils/drivers.interface';
import {
  AddTruckTypesFromCatalogInput,
  CreateTruckTypeInput,
  ResolveTruckTypeInput,
} from './utils/truck-type.interface';
import {
  CreateLoadingPointInput,
  ListLoadingPointCitiesInput,
  ListLoadingPointsInput,
  UpdateLoadingPointInput,
} from './utils/loading-point.interface';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetDriverLinkService } from './fleet-driver-link.service';
import { TruckTypeService } from './truck-type.service';
import { TruckTypeCatalogService } from './truck-type-catalog.service';
import { LoadingPointService } from './loading-point.service';
import { TransporterService } from './transporter.service';
import { ListTransportersInput } from './utils/transporter.interface';
import { ProductService } from './product.service';
import {
  CreateProductInput,
  ListProductsInput,
  UpdateProductInput,
} from './utils/product.interface';

export class MastersController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly fleetDriverLinkService: FleetDriverLinkService,
    private readonly truckTypeService: TruckTypeService,
    private readonly truckTypeCatalogService: TruckTypeCatalogService,
    private readonly loadingPointService: LoadingPointService,
    private readonly transporterService: TransporterService,
    private readonly productService: ProductService,
  ) {}

  listTruckTypes = async (req: Request, res: Response) => {
    const truckTypes = await this.truckTypeService.listTruckTypes(requireTenantId(req));
    respond(res, truckTypes);
  };

  listTruckTypeCatalog = async (_req: Request, res: Response) => {
    const catalog = await this.truckTypeCatalogService.listCatalog();
    respond(res, catalog);
  };

  addTruckTypesFromCatalog = async (req: Request, res: Response) => {
    const truckTypes = await this.truckTypeService.addFromCatalog(
      requireTenantId(req),
      req.user!.id,
      req.body as AddTruckTypesFromCatalogInput,
    );
    respond(res, truckTypes, 201);
  };

  resolveTruckType = async (req: Request, res: Response) => {
    const truckType = await this.truckTypeService.resolveFromCatalog(
      requireTenantId(req),
      req.user!.id,
      req.body as ResolveTruckTypeInput,
    );
    respond(res, truckType, 200);
  };

  createTruckType = async (req: Request, res: Response) => {
    const truckType = await this.truckTypeService.createTruckType(
      requireTenantId(req),
      req.user!.id,
      req.body as CreateTruckTypeInput,
    );
    respond(res, truckType, 201);
  };

  deleteTruckType = async (req: Request<TruckTypeParams>, res: Response) => {
    await this.truckTypeService.deleteTruckType(
      requireTenantId(req),
      req.user!.id,
      req.params.truckTypeId,
    );
    respond(res, { success: true });
  };

  listLoadingPoints = async (req: Request, res: Response) => {
    const loadingPoints = await this.loadingPointService.list(
      requireTenantId(req),
      req.validatedQuery as ListLoadingPointsInput,
    );
    respond(res, loadingPoints);
  };

  listLoadingPointCities = async (req: Request, res: Response) => {
    const cities = await this.loadingPointService.listCities(
      requireTenantId(req),
      req.validatedQuery as ListLoadingPointCitiesInput,
    );
    respond(res, cities);
  };

  getLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.get(
      requireTenantId(req),
      req.params.loadingPointId as string,
    );
    respond(res, loadingPoint);
  };

  createLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.create(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.body as CreateLoadingPointInput,
    );
    respond(res, loadingPoint, 201);
  };

  updateLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.update(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
      req.body as UpdateLoadingPointInput,
    );
    respond(res, loadingPoint);
  };

  approveLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.approve(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
    );
    respond(res, loadingPoint);
  };

  rejectLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.reject(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
      (req.body as { reason: string }).reason,
    );
    respond(res, loadingPoint);
  };

  deleteLoadingPoint = async (req: Request, res: Response) => {
    await this.loadingPointService.delete(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
    );
    respond(res, { success: true });
  };

  listProducts = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.list(requireTenantId(req), req.validatedQuery as ListProductsInput),
    );
  getProduct = async (req: Request, res: Response) =>
    respond(res, await this.productService.get(requireTenantId(req), String(req.params.productId)));
  createProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.create(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body as CreateProductInput,
      ),
      201,
    );
  updateProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.update(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body as UpdateProductInput,
      ),
    );
  approveProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.approve(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
      ),
    );
  rejectProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.reject(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body.reason,
      ),
    );
  deleteProduct = async (req: Request, res: Response) => {
    await this.productService.delete(
      requireTenantId(req),
      req.user!.id,
      String(req.params.productId),
    );
    respond(res, { success: true });
  };
  setProductStatus = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.setStatus(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body.status,
      ),
    );

  createTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.create(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body,
      ),
      201,
    );
  listTransporters = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.list(
        requireTenantId(req),
        req.user!.role,
        req.validatedQuery as ListTransportersInput,
      ),
    );
  getTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.get(
        requireTenantId(req),
        req.user!.role,
        String(req.params.transporterId),
      ),
    );
  updateTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.update(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        String(req.params.transporterId),
        req.body,
      ),
    );
  deleteTransporter = async (req: Request, res: Response) => {
    await this.transporterService.delete(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      String(req.params.transporterId),
    );
    respond(res, { success: true });
  };

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
      req.user!.role,
      req.params.driverId,
      req.body,
    );
    respond(res, document, 201);
  };

  listDriverDocuments = async (req: Request<DriverParams>, res: Response) => {
    const documents = await this.driverService.listDocuments(
      requireTenantId(req),
      req.user!.role,
      req.params.driverId,
    );
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
    const verifications = await this.driverService.listVerifications(
      requireTenantId(req),
      req.params.driverId,
    );
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
    const bankDetails = await this.driverService.listBankDetails(
      requireTenantId(req),
      req.params.driverId,
    );
    respond(res, bankDetails);
  };

  setDriverBankDetailsVerification = async (
    req: Request<DriverBankDetailsParams>,
    res: Response,
  ) => {
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
    const links = await this.fleetDriverLinkService.listVehicleLinks(
      requireTenantId(req),
      req.params.vehicleId,
    );
    respond(res, links);
  };

  listDriverLinks = async (req: Request<DriverParams>, res: Response) => {
    const links = await this.fleetDriverLinkService.listDriverLinks(
      requireTenantId(req),
      req.params.driverId,
    );
    respond(res, links);
  };

  setLinkPrimary = async (req: Request<LinkParams>, res: Response) => {
    const link = await this.fleetDriverLinkService.setPrimary(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
    );
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
    await this.fleetDriverLinkService.deleteLink(
      requireTenantId(req),
      req.user!.id,
      req.params.linkId,
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

  verifyDriverDl = async (req: Request, res: Response) => {
    const result = await this.driverService.checkDrivingLicence(
      req.body.licenseNumber,
      req.body.dateOfBirth,
    );
    respond(res, result);
  };

  onboardDriver = async (req: Request, res: Response) => {
    const driver = await this.driverService.onboardDriver(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.body,
    );
    respond(res, driver, 201);
  };

  approveDriver = async (req: Request<DriverParams>, res: Response) => {
    const driver = await this.driverService.approveDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
    );
    respond(res, driver);
  };

  rejectDriver = async (req: Request<DriverParams>, res: Response) => {
    const driver = await this.driverService.rejectDriver(
      requireTenantId(req),
      req.user!.id,
      req.params.driverId,
      req.body.reason,
    );
    respond(res, driver);
  };

  getDriverOperationalStatus = async (req: Request<DriverParams>, res: Response) => {
    const status = await this.driverService.getOperationalStatus(
      requireTenantId(req),
      req.params.driverId,
    );
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
    const metrics = await this.driverService.listTripMetrics(
      requireTenantId(req),
      req.params.driverId,
    );
    respond(res, metrics);
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
