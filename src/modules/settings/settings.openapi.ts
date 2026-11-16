import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { LS_SETTINGS_MANAGE } from '../../shared/constants/permissions';
import { TAGS, json, permissionGated } from '../../shared/openapi/core';
import { SETTINGS_READERS } from './settings.routes';
import { settingsValidators as v } from './settings.validators';

const BASE = `${API_VERSION_PREFIX}/loadsmart-ops/settings`;

export function registerSettingsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.LOADS],
    operationId: 'settings.getCurrent',
    ...permissionGated(
      SETTINGS_READERS,
      'The latest settings version — the values loads posted from now on run on.',
    ),
    responses: { 200: { description: 'OK' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/versions`,
    tags: [TAGS.LOADS],
    operationId: 'settings.listVersions',
    ...permissionGated([LS_SETTINGS_MANAGE], 'Every saved version, latest first.'),
    request: { query: v.versions.shape.query },
    responses: { 200: { description: 'OK' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/versions/{versionId}`,
    tags: [TAGS.LOADS],
    operationId: 'settings.getVersion',
    ...permissionGated([LS_SETTINGS_MANAGE], 'One saved version — what a load was posted under.'),
    request: { params: v.version.shape.params },
    responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
  });
  registry.registerPath({
    method: 'put',
    path: BASE,
    tags: [TAGS.LOADS],
    operationId: 'settings.save',
    ...permissionGated(
      [LS_SETTINGS_MANAGE],
      'Save every setting as the next version. Applies only to loads posted after the save. ' +
        'Send `basedOnVersion` to get a 409 if someone saved in between.',
    ),
    request: { body: json(v.save.shape.body) },
    responses: { 201: { description: 'Saved' }, 409: { description: 'A newer version exists' } },
  });
}
