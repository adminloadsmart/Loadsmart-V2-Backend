import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import {
  DriverBankDetailsParams,
  DriverDocumentParams,
  DriverParams,
  ListDriversInput,
} from './drivers.interface';
import { DriverService } from './driver.service';

export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  listDrivers = async (req: Request, res: Response) => {
    // `validate` middleware (driver.routes.ts) has already coerced/defaulted this against
    // driverValidators.listDrivers before this runs — see req.validatedQuery's doc comment
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
}
