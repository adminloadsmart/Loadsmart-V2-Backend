import { Router } from 'express';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { createTruckTypeRoutes } from './truck-type/truck-type.routes';
import { TruckTypeController } from './truck-type/truck-type.controller';
import { createProductRoutes } from './product/product.routes';
import { ProductController } from './product/product.controller';
import { ProductImportController } from './product/product-import.controller';
import { createLoadingPointRoutes } from './loading-point/loading-point.routes';
import { LoadingPointController } from './loading-point/loading-point.controller';
import { LoadingPointImportController } from './loading-point/loading-point-import.controller';
import { createTransporterRoutes } from './transporter/transporter.routes';
import { TransporterController } from './transporter/transporter.controller';
import { TransporterImportController } from './transporter/transporter-import.controller';
import { createVehicleRoutes } from './vehicle/vehicle.routes';
import { VehicleController } from './vehicle/vehicle.controller';
import { createDriverRoutes } from './driver/driver.routes';
import { DriverController } from './driver/driver.controller';
import { createFleetDriverLinkRoutes } from './fleet-driver-link/fleet-driver-link.routes';
import { FleetDriverLinkController } from './fleet-driver-link/fleet-driver-link.controller';

export function createMastersProtectedRoutes(
  truckTypeController: TruckTypeController,
  productController: ProductController,
  productImportController: ProductImportController,
  loadingPointController: LoadingPointController,
  loadingPointImportController: LoadingPointImportController,
  transporterController: TransporterController,
  transporterImportController: TransporterImportController,
  vehicleController: VehicleController,
  driverController: DriverController,
  fleetDriverLinkController: FleetDriverLinkController,
): Router {
  const router = Router();

  // Tenant-owned resources only — no platform-scope caller (platform_admin/staff) has any
  // business here, unlike /roles or /admin. See require-tenant.middleware.ts.
  router.use(requireTenant);

  router.use(createTruckTypeRoutes(truckTypeController));
  router.use(createProductRoutes(productController, productImportController));
  router.use(createLoadingPointRoutes(loadingPointController, loadingPointImportController));
  router.use(createTransporterRoutes(transporterController, transporterImportController));
  router.use(createVehicleRoutes(vehicleController));
  router.use(createDriverRoutes(driverController));
  router.use(createFleetDriverLinkRoutes(fleetDriverLinkController));

  return router;
}
