import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { CustomerService } from '../customers/customer.service';
import { VehicleService } from '../masters/vehicle.service';
import { DriverService } from '../masters/driver.service';
import { TransporterService } from '../masters/transporter.service';
import { TruckTypeService } from '../masters/truck-type.service';
import { LoadingPointService } from '../masters/loading-point.service';
import { ProductService } from '../masters/product.service';

import { RequisitionRepository } from './requisition.repository';
import { RequisitionService } from './requisition.service';
import { LoadRepository } from './load.repository';
import { LoadService } from './load.service';
import { LoadPaymentRepository } from './load-payment.repository';
import { LoadPaymentService } from './load-payment.service';
import { LoadActivityRepository } from './load-activity.repository';
import { LoadActivityService } from './load-activity.service';
import { DispatchPlanningService } from './dispatch-planning.service';
import { LoadsController } from './loads.controller';
import { createLoadsProtectedRoutes } from './loads.routes';

export function createLoadsModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    storageService: StorageService;
    customerService: CustomerService;
    vehicleService: VehicleService;
    driverService: DriverService;
    transporterService: TransporterService;
    truckTypeService: TruckTypeService;
    loadingPointService: LoadingPointService;
    productService: ProductService;
  },
) {
  const loadActivityRepository = new LoadActivityRepository(dataSource);
  const loadActivityService = new LoadActivityService(loadActivityRepository);

  const requisitionRepository = new RequisitionRepository(dataSource);
  const loadRepository = new LoadRepository(dataSource);
  const loadPaymentRepository = new LoadPaymentRepository(dataSource);

  const requisitionService = new RequisitionService(
    requisitionRepository,
    loadRepository,
    deps.customerService,
    deps.productService,
    deps.loadingPointService,
    deps.auditService,
  );

  const loadService = new LoadService(
    loadRepository,
    loadPaymentRepository,
    deps.vehicleService,
    deps.driverService,
    deps.transporterService,
    deps.storageService,
    loadActivityService,
    deps.auditService,
  );

  const loadPaymentService = new LoadPaymentService(
    loadPaymentRepository,
    loadRepository,
    deps.transporterService,
    loadActivityService,
    deps.auditService,
  );

  const dispatchPlanningService = new DispatchPlanningService(
    dataSource,
    requisitionRepository,
    loadRepository,
    deps.vehicleService,
    deps.transporterService,
    deps.truckTypeService,
    loadActivityService,
    deps.auditService,
  );

  const controller = new LoadsController(
    requisitionService,
    dispatchPlanningService,
    loadService,
    loadPaymentService,
    loadActivityService,
  );
  const protectedRouter = createLoadsProtectedRoutes(controller);

  return {
    requisitionService,
    loadService,
    loadPaymentService,
    loadActivityService,
    dispatchPlanningService,
    protectedRouter,
  };
}
