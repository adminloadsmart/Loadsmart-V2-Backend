import { DataSource } from 'typeorm';
import { VehicleRepository } from './vehicle.repository';
import { VehicleService } from './vehicle.service';
import { DriverRepository } from './driver.repository';
import { DriverService } from './driver.service';
import { SarathiClient } from './sarathi.client';
import { FleetDriverLinkRepository } from './fleet-driver-link.repository';
import { FleetDriverLinkService } from './fleet-driver-link.service';
import { TruckTypeRepository } from './truck-type.repository';
import { TruckTypeService } from './truck-type.service';
import { MastersController } from './masters.controller';
import { createMastersProtectedRoutes } from './masters.routes';

export function createMastersModule(dataSource: DataSource) {
  // Built before vehicles: vehicle.service.ts validates a vehicle's truckTypeId against it.
  const truckTypeRepository = new TruckTypeRepository(dataSource);
  const truckTypeService = new TruckTypeService(truckTypeRepository);

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
  );
  const sarathiClient = new SarathiClient();
  const driverService = new DriverService(driverRepository, dataSource, sarathiClient);

  const controller = new MastersController(
    vehicleService,
    driverService,
    fleetDriverLinkService,
    truckTypeService,
  );
  const protectedRouter = createMastersProtectedRoutes(controller);

  return {
    vehicleService,
    driverService,
    fleetDriverLinkService,
    truckTypeService,
    protectedRouter,
  };
}
