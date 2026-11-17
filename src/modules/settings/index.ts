import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { createSettingsRoutes } from './settings.routes';

/** Super Admin → Settings (S03). Built before the loads module, which reads every timer and
 *  threshold through `service` (as a SettingsReader). The router is mounted on the ops console
 *  at /loadsmart-ops/settings. */
export function createSettingsModule(dataSource: DataSource, deps: { auditService: AuditService }) {
  const service = new SettingsService(new SettingsRepository(dataSource), deps.auditService);
  return { service, router: createSettingsRoutes(new SettingsController(service)) };
}
