import { MasterApprovalNotifier } from '../notifications/master-approvals';
import { DataSource } from 'typeorm';
import { UlipClient } from '../../adapters/ulip.client';
import { VehicleRepository } from './vehicle/vehicle.repository';
import { VehicleService } from './vehicle/vehicle.service';
import { VehicleController } from './vehicle/vehicle.controller';
import { VehicleImportService } from './vehicle/vehicle-import.service';
import { VehicleImportController } from './vehicle/vehicle-import.controller';
import { DriverTenantRelationRepository } from '../driver/driver-tenant-relation.repository';
import { DriverController } from '../driver/driver.controller';
import { DriverImportController } from '../driver/driver-import.controller';
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
import { StorageService } from '../storage/storage.service';
import { ProductRepository } from './product/product.repository';
import { ProductService } from './product/product.service';
import { ProductController } from './product/product.controller';
import { ProductImportService } from './product/product-import.service';
import { ProductImportController } from './product/product-import.controller';
import { IdfyClient } from '../../adapters/idfy.client';
import { GstRateGate } from './gst/gst-rate-gate';
import { GST_VERIFICATION_QUEUE } from './gst/gst-background-verification';
import { TransporterGstVerificationService } from './transporter/transporter-gst-verification.service';
import { TransporterEntity } from './transporter/entities/transporter.entity';
import { createJobQueue } from '../../jobs/queue-registry';
import { redisManager } from '../../db/redis';
import { GstVerificationRepository } from './gst/gst.repository';
import { GstVerificationService } from './gst/gst.service';
import { GstController } from './gst/gst.controller';
import { MasterUsageRepository } from './masters.usage';
import { CodeSequenceRepository } from '../loads/code-sequence.repository';
import { ContractRepository } from './contract/contract.repository';
import { ContractService } from './contract/contract.service';
import { ContractImportService } from './contract/contract-import.service';
import { ContractController } from './contract/contract.controller';
import { MastersSummaryService } from './summary/summary.service';
import { MastersSummaryController } from './summary/summary.controller';

export function createMastersModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    storageService: StorageService;
    // Driver is now built by its own module (src/modules/driver/) — masters only consumes the
    // tenant-relation repository (fleetDriverLinkService validates a link's driver-tenant relation
    // against it) and the controller (still composed into this module's own protected router,
    // unchanged URLs).
    driverTenantRelationRepository: DriverTenantRelationRepository;
    driverController: DriverController;
    driverImportController: DriverImportController;
    // LS_N_0009/0010 — optional; see modules/notifications/master-approvals.ts.
    masterApprovalNotifier?: MasterApprovalNotifier;
  },
) {
  // Built before vehicles: vehicle.service.ts validates a vehicle's truckTypeId against it.
  const truckTypeRepository = new TruckTypeRepository(dataSource);
  const truckTypeCatalogRepository = new TruckTypeCatalogRepository(dataSource);
  const truckTypeCatalogService = new TruckTypeCatalogService(truckTypeCatalogRepository);
  const truckTypeService = new TruckTypeService(truckTypeRepository, truckTypeCatalogRepository);
  const truckTypeController = new TruckTypeController(truckTypeService, truckTypeCatalogService);

  // Settings → Masters "Verify GST" — also handed to the customers module (composition-root).
  const idfyClient = new IdfyClient();
  // One IDfy GST lookup per window across the Verify button and the bulk-import worker.
  const gstRateGate = new GstRateGate(redisManager);
  const masterUsageRepository = new MasterUsageRepository(dataSource);
  const gstVerificationService = new GstVerificationService(
    new GstVerificationRepository(dataSource),
    idfyClient,
    deps.auditService,
    gstRateGate,
  );
  const gstController = new GstController(gstVerificationService);

  const transporterRepository = new TransporterRepository(dataSource);
  const transporterService = new TransporterService(
    transporterRepository,
    deps.auditService,
    new CodeSequenceRepository(dataSource),
    gstVerificationService,
    masterUsageRepository,
    idfyClient,
  );
  const transporterController = new TransporterController(transporterService);
  // Bulk-imported GSTINs are verified in the background on the shared 'gst-verification' queue.
  const transporterGstVerification = new TransporterGstVerificationService(
    dataSource.getRepository(TransporterEntity),
    gstVerificationService,
    gstRateGate,
    deps.auditService,
    createJobQueue(GST_VERIFICATION_QUEUE),
  );
  const transporterImportService = new TransporterImportService(
    transporterService,
    transporterRepository,
    deps.auditService,
    transporterGstVerification,
  );
  const transporterImportController = new TransporterImportController(transporterImportService);

  // Settings → Masters → Contracts — built on the transporter service (active-transporter check).
  const contractService = new ContractService(
    new ContractRepository(dataSource),
    transporterService,
    deps.auditService,
  );
  const contractController = new ContractController(
    contractService,
    new ContractImportService(dataSource, contractService, deps.auditService),
  );
  const mastersSummaryController = new MastersSummaryController(
    new MastersSummaryService(dataSource),
  );

  const loadingPointRepository = new LoadingPointRepository(dataSource);
  const loadingPointService = new LoadingPointService(
    loadingPointRepository,
    deps.auditService,
    masterUsageRepository,
    deps.masterApprovalNotifier,
  );
  const loadingPointController = new LoadingPointController(loadingPointService);
  const loadingPointImportService = new LoadingPointImportService(
    loadingPointService,
    loadingPointRepository,
    deps.auditService,
  );
  const loadingPointImportController = new LoadingPointImportController(loadingPointImportService);

  const productRepository = new ProductRepository(dataSource);
  const productService = new ProductService(
    productRepository,
    deps.auditService,
    deps.masterApprovalNotifier,
  );
  const productController = new ProductController(productService);
  const productImportService = new ProductImportService(
    productService,
    productRepository,
    deps.auditService,
  );
  const productImportController = new ProductImportController(productImportService);

  const vehicleRepository = new VehicleRepository(dataSource);

  // Built on the repositories (not VehicleService/DriverService) so it has no dependency on
  // VehicleService — which itself depends on this service to link a driver during onboarding.
  const fleetDriverLinkRepository = new FleetDriverLinkRepository(dataSource);
  const fleetDriverLinkService = new FleetDriverLinkService(
    fleetDriverLinkRepository,
    vehicleRepository,
    deps.driverTenantRelationRepository,
    dataSource,
  );
  const fleetDriverLinkController = new FleetDriverLinkController(fleetDriverLinkService);

  const vehicleService = new VehicleService(
    vehicleRepository,
    truckTypeService,
    fleetDriverLinkService,
    dataSource,
    deps.auditService,
    new UlipClient(),
    deps.masterApprovalNotifier,
  );
  const vehicleController = new VehicleController(vehicleService);
  const vehicleImportService = new VehicleImportService(vehicleService, deps.auditService);
  const vehicleImportController = new VehicleImportController(vehicleImportService);

  const protectedRouter = createMastersProtectedRoutes(
    truckTypeController,
    productController,
    productImportController,
    loadingPointController,
    loadingPointImportController,
    transporterController,
    transporterImportController,
    vehicleController,
    vehicleImportController,
    deps.driverController,
    deps.driverImportController,
    fleetDriverLinkController,
    gstController,
    contractController,
    mastersSummaryController,
  );

  return {
    gstVerificationService,
    gstRateGate,
    transporterGstVerification,
    contractService,
    vehicleService,
    fleetDriverLinkService,
    truckTypeService,
    truckTypeCatalogService,
    loadingPointService,
    transporterService,
    productService,
    protectedRouter,
  };
}
