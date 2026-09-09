import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { registerTruckTypeOpenApi } from './truck-type/truck-type.openapi';
import { registerProductOpenApi } from './product/product.openapi';
import { registerLoadingPointOpenApi } from './loading-point/loading-point.openapi';
import { registerTransporterOpenApi } from './transporter/transporter.openapi';
import { registerVehicleOpenApi } from './vehicle/vehicle.openapi';
import { registerDriverOpenApi } from './driver/driver.openapi';
import { registerFleetDriverLinkOpenApi } from './fleet-driver-link/fleet-driver-link.openapi';

/**
 * OpenAPI docs for the masters module: registers every route in masters.routes.ts, under the
 * `masters` tag. Each domain's paths live in that domain's own `*.openapi.ts`, in the same order
 * as that domain's `*.routes.ts` — this just aggregates them.
 *
 * Each domain's validators are never imported for anything but their Zod schemas — request shapes
 * are the literal same schema objects used by the `validate()` middleware, not redescribed.
 * Success response *bodies* aren't documented (see core.ts) — only status code + description —
 * except for the fixed `{ success: true }` shape on delete endpoints.
 */
export function registerMastersOpenApi(registry: OpenAPIRegistry): void {
  registerTruckTypeOpenApi(registry);
  registerProductOpenApi(registry);
  registerLoadingPointOpenApi(registry);
  registerTransporterOpenApi(registry);
  registerVehicleOpenApi(registry);
  registerDriverOpenApi(registry);
  registerFleetDriverLinkOpenApi(registry);
}
