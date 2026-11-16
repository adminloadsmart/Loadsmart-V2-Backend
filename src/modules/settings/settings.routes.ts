import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import {
  LS_APPROVAL,
  LS_CS,
  LS_MONEY_APPROVE,
  LS_PAYABLES,
  LS_PLACEMENT,
  LS_RECEIVABLES,
  LS_SETTINGS_MANAGE,
  LS_TRACKING,
} from '../../shared/constants/permissions';
import { SettingsController } from './settings.controller';
import { settingsValidators as v } from './settings.validators';

/** Every console team reads the settings their work runs on; only Super Admin changes them. */
export const SETTINGS_READERS = [
  LS_SETTINGS_MANAGE,
  LS_MONEY_APPROVE,
  LS_APPROVAL,
  LS_PLACEMENT,
  LS_TRACKING,
  LS_CS,
  LS_RECEIVABLES,
  LS_PAYABLES,
];

/** /v1/loadsmart-ops/settings — Super Admin → Settings (S03). */
export function createSettingsRoutes(c: SettingsController): Router {
  const router = Router();
  const canRead = requirePermission(...SETTINGS_READERS);
  const canManage = requirePermission(LS_SETTINGS_MANAGE);

  router.get('/', canRead, asyncHandler(c.getCurrent));
  router.get('/versions', canManage, validate(v.versions), asyncHandler(c.listVersions));
  router.get('/versions/:versionId', canManage, validate(v.version), asyncHandler(c.getVersion));
  router.put('/', canManage, validate(v.save), asyncHandler(c.save));
  return router;
}
