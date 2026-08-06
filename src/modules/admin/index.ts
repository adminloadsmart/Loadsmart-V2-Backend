import { OrganizationService } from '../auth/organization.service';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { createAdminRoutes } from './admin.routes';

export function createAdminModule(deps: { organizationService: OrganizationService; authService: AuthService }) {
  const service = new AdminService(deps.organizationService, deps.authService);
  const controller = new AdminController(service);
  const router = createAdminRoutes(controller);

  return { router };
}
