import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { GeofenceRepository } from './geofence.repository';
import { GeofenceService } from './geofence.service';
import { GeofencesController } from './geofences.controller';
import { createGeofencesRoutes } from './geofences.routes';
import { NotificationsService } from '../notifications/notifications.service';
import { createGeofenceEventNotifier } from './geofence-alerts';

export function createGeofencesModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    authService: AuthService;
    notificationsService: NotificationsService;
  },
) {
  const repository = new GeofenceRepository(dataSource);
  const service = new GeofenceService(
    repository,
    deps.authService,
    deps.auditService,
    createGeofenceEventNotifier(deps.notificationsService),
  );
  const controller = new GeofencesController(service);
  const router = createGeofencesRoutes(controller);
  return { service, router };
}
