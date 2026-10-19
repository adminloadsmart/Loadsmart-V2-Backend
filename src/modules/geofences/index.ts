import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { GeofenceRepository } from './geofence.repository';
import { GeofenceService } from './geofence.service';
import { GeofencesController } from './geofences.controller';
import { createGeofencesRoutes } from './geofences.routes';
import { NotificationsService } from '../notifications/notifications.service';
import { createGeofenceEventNotifier } from './geofence-alerts';
import { GeofenceLoadAdvancer } from './utils/geofence.interface';

export function createGeofencesModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    authService: AuthService;
    advanceLoad?: GeofenceLoadAdvancer;
    notificationsService: NotificationsService;
  },
) {
  const repository = new GeofenceRepository(dataSource);
  const service = new GeofenceService(
    repository,
    deps.authService,
    deps.auditService,
    deps.advanceLoad,
    createGeofenceEventNotifier(deps.notificationsService),
  );
  const controller = new GeofencesController(service);
  const router = createGeofencesRoutes(controller);
  return { service, router };
}
