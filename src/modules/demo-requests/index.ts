import { DataSource } from 'typeorm';
import { DemoRequestsController } from './demo-requests.controller';
import { DemoRequestsRepository } from './demo-requests.repository';
import { createDemoRequestsRoutes } from './demo-requests.routes';
import { DemoRequestsService } from './demo-requests.service';

/** Landing page "Book a Demo" requests. Only the public router crosses the boundary. */
export function createDemoRequestsModule(dataSource: DataSource) {
  const service = new DemoRequestsService(new DemoRequestsRepository(dataSource));
  return { router: createDemoRequestsRoutes(new DemoRequestsController(service)) };
}
