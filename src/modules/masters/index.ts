import { DataSource } from 'typeorm';
import { VehicleRepository } from './vehicle.repository';
import { VehicleService } from './vehicle.service';
import { DriverRepository } from './driver.repository';
import { DriverService } from './driver.service';
import { FleetDriverLinkRepository } from './fleet-driver-link.repository';
import { FleetDriverLinkService } from './fleet-driver-link.service';
import { TruckTypeRepository } from './truck-type.repository';
import { TruckTypeService } from './truck-type.service';
import { LoadingPointRepository } from './loading-point.repository';
import { LoadingPointService } from './loading-point.service';
import { MastersController } from './masters.controller';
import { createMastersProtectedRoutes } from './masters.routes';
import { AuditService } from '../audit/audit.service';
import { TransporterRepository } from './transporter.repository';
import { TransporterService } from './transporter.service';
import { TransporterImportService } from './transporter-import.service';
import { TransporterImportController } from './transporter-import.controller';
import { SarathiClient } from '../../adapters/sarathi.client';

export function createMastersModule(dataSource: DataSource, deps: { auditService: AuditService }) {
  // Built before vehicles: vehicle.service.ts validates a vehicle's truckTypeId against it.
  const truckTypeRepository = new TruckTypeRepository(dataSource);
  const truckTypeService = new TruckTypeService(truckTypeRepository);
  const transporterRepository = new TransporterRepository(dataSource);
  const transporterService = new TransporterService(transporterRepository, deps.auditService);
  const transporterImportService = new TransporterImportService(
    transporterService,
    deps.auditService,
  );
  const transporterImportController = new TransporterImportController(transporterImportService);
  const loadingPointRepository = new LoadingPointRepository(dataSource);
  const loadingPointService = new LoadingPointService(loadingPointRepository, deps.auditService);

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

  const vehicleService = new VehicleService(
    vehicleRepository,
    truckTypeService,
    fleetDriverLinkService,
    dataSource,
    deps.auditService,
  );
  const sarathiClient = new SarathiClient();
  const driverService = new DriverService(
    driverRepository,
    dataSource,
    sarathiClient,
    deps.auditService,
  );

  const controller = new MastersController(
    vehicleService,
    driverService,
    fleetDriverLinkService,
    truckTypeService,
    loadingPointService,
    transporterService,
  );
  const protectedRouter = createMastersProtectedRoutes(controller, transporterImportController);

  return {
    vehicleService,
    driverService,
    fleetDriverLinkService,
    truckTypeService,
    loadingPointService,
    transporterService,
    protectedRouter,
  };
}
