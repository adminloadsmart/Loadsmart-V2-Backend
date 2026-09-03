import { DataSource } from 'typeorm';
import { VehicleRepository } from './vehicle/vehicle.repository';
import { VehicleService } from './vehicle/vehicle.service';
import { VehicleController } from './vehicle/vehicle.controller';
import { DriverRepository } from './driver/driver.repository';
import { DriverService } from './driver/driver.service';
import { DriverController } from './driver/driver.controller';
import { FleetDriverLinkRepository } from './fleet-driver-link/fleet-driver-link.repository';
import { FleetDriverLinkService } from './fleet-driver-link/fleet-driver-link.service';
import { FleetDriverLinkController } from './fleet-driver-link/fleet-driver-link.controller';
import { TruckTypeRepository } from './truck-type/truck-type.repository';
import { TruckTypeService } from './truck-type/truck-type.service';
import { TruckTypeController } from './truck-type/truck-type.controller';
import { TruckTypeCatalogRepository } from './truck-type-catalog/truck-type-catalog.repository';
import { TruckTypeCatalogService } from './truck-type-catalog/truck-type-catalog.service';
import { LoadingPointRepository } from './loading-point/loading-point.repository';
import { LoadingPointService } from './loading-point/loading-point.service';
import { LoadingPointController } from './loading-point/loading-point.controller';
import { LoadingPointImportService } from './loading-point/loading-point-import.service';
import { LoadingPointImportController } from './loading-point/loading-point-import.controller';
import { createMastersProtectedRoutes } from './masters.routes';
import { AuditService } from '../audit/audit.service';
import { TransporterRepository } from './transporter/transporter.repository';
import { TransporterService } from './transporter/transporter.service';
import { TransporterController } from './transporter/transporter.controller';
import { TransporterImportService } from './transporter/transporter-import.service';
import { TransporterImportController } from './transporter/transporter-import.controller';
import { SarathiClient } from '../../adapters/sarathi.client';
import { StorageService } from '../storage/storage.service';
import { ProductRepository } from './product/product.repository';
import { ProductService } from './product/product.service';
import { ProductController } from './product/product.controller';
import { ProductImportService } from './product/product-import.service';
import { ProductImportController } from './product/product-import.controller';

export function createMastersModule(
  dataSource: DataSource,
  deps: { auditService: AuditService; storageService: StorageService },
) {
  // Built before vehicles: vehicle.service.ts validates a vehicle's truckTypeId against it.
  const truckTypeRepository = new TruckTypeRepository(dataSource);
  const truckTypeCatalogRepository = new TruckTypeCatalogRepository(dataSource);
  const truckTypeCatalogService = new TruckTypeCatalogService(truckTypeCatalogRepository);
  const truckTypeService = new TruckTypeService(truckTypeRepository, truckTypeCatalogRepository);
  const truckTypeController = new TruckTypeController(truckTypeService, truckTypeCatalogService);

  const transporterRepository = new TransporterRepository(dataSource);
  const transporterService = new TransporterService(transporterRepository, deps.auditService);
  const transporterController = new TransporterController(transporterService);
  const transporterImportService = new TransporterImportService(
    transporterService,
    deps.auditService,
  );
  const transporterImportController = new TransporterImportController(transporterImportService);

  const loadingPointRepository = new LoadingPointRepository(dataSource);
  const loadingPointService = new LoadingPointService(loadingPointRepository, deps.auditService);
  const loadingPointController = new LoadingPointController(loadingPointService);
  const loadingPointImportService = new LoadingPointImportService(
    loadingPointService,
    deps.auditService,
  );
  const loadingPointImportController = new LoadingPointImportController(loadingPointImportService);

  const productRepository = new ProductRepository(dataSource);
  const productService = new ProductService(productRepository, deps.auditService);
  const productController = new ProductController(productService);
  const productImportService = new ProductImportService(productService, deps.auditService);
  const productImportController = new ProductImportController(productImportService);

  const vehicleRepository = new VehicleRepository(dataSource);
  const driverRepository = new DriverRepository(dataSource);

  // Built on the repositories (not VehicleService/DriverService) so it has no dependency on
  // VehicleService — which itself depends on this service to link a driver during onboarding.
  const fleetDriverLinkRepository = new FleetDriverLinkRepository(dataSource);
  const fleetDriverLinkService = new FleetDriverLinkService(
    fleetDriverLinkRepository,
    vehicleRepository,
    driverRepository,
    dataSource,
  );
  const fleetDriverLinkController = new FleetDriverLinkController(fleetDriverLinkService);

  const vehicleService = new VehicleService(
    vehicleRepository,
    truckTypeService,
    fleetDriverLinkService,
    dataSource,
    deps.auditService,
  );
  const vehicleController = new VehicleController(vehicleService);

  const sarathiClient = new SarathiClient();
  const driverService = new DriverService(
    driverRepository,
    dataSource,
    sarathiClient,
    deps.auditService,
    deps.storageService,
  );
  const driverController = new DriverController(driverService);

  const protectedRouter = createMastersProtectedRoutes(
    truckTypeController,
    productController,
    productImportController,
    loadingPointController,
    loadingPointImportController,
    transporterController,
    transporterImportController,
    vehicleController,
    driverController,
    fleetDriverLinkController,
  );

  return {
    vehicleService,
    driverService,
    fleetDriverLinkService,
    truckTypeService,
    truckTypeCatalogService,
    loadingPointService,
    transporterService,
    productService,
    protectedRouter,
  };
}
