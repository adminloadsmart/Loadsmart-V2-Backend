import { GooglePlacesClient } from '../../adapters/google-places.client';
import { PlacesService } from './places.service';
import { PlacesController } from './places.controller';
import { createPlacesRoutes } from './places.routes';

// Stateless — no DataSource. Controller/validators stay private; only `router` and `service`
// cross the boundary so a later consumer (e.g. loads) can inject the service directly.
export function createPlacesModule() {
  const service = new PlacesService(new GooglePlacesClient());
  const controller = new PlacesController(service);
  return { router: createPlacesRoutes(controller), service };
}
