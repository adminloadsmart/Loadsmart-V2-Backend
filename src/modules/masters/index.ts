import { DataSource } from 'typeorm';
import { VehicleRepository } from './vehicle.repository';
import { VehicleService } from './vehicle.service';
import { DriverRepository } from './driver.repository';
import { DriverService } from './driver.service';
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
  const vehicleService = new VehicleService(vehicleRepository, truckTypeService, dataSource);

  const driverRepository = new DriverRepository(dataSource);
  const driverService = new DriverService(driverRepository, dataSource);

  const fleetDriverLinkRepository = new FleetDriverLinkRepository(dataSource);
  const fleetDriverLinkService = new FleetDriverLinkService(
    fleetDriverLinkRepository,
    vehicleService,
    driverService,
    dataSource,
  );

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
