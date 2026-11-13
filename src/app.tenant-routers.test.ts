import { describe, expect, it } from 'vitest';
import { Router, RequestHandler } from 'express';
import request from 'supertest';
import { createApp } from './app';
import type { Container } from './composition-root';
import { API_VERSION_PREFIX } from './shared/constants/api';
import type { AuthenticatedUser } from './shared/middleware/request.types';

// A router that answers 200 to anything — no requireTenant of its own, so the only thing that can
// refuse a staff caller here is the mount itself.
function okRouter(): Router {
  const router = Router();
  router.get('/ping', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return router;
}

const staff: AuthenticatedUser = {
  id: 'staff-1',
  tenantId: null,
  role: 'sales',
  permissions: [],
  permissionsVersion: 1,
  portal: 'platform',
};
const orgUser: AuthenticatedUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  role: 'dispatch',
  permissions: [],
  permissionsVersion: 1,
  portal: 'organization',
};

function appAs(user: AuthenticatedUser) {
  const auth: RequestHandler = (req, _res, next) => {
    req.user = user;
    next();
  };
  const passThrough: RequestHandler = (_req, _res, next) => next();
  const container = {
    tenancyGateway: { assertTenantActive: async () => undefined },
    authMiddleware: auth,
    auditMiddleware: passThrough,
    publicRouters: [],
    authenticatedRouters: [],
    routers: [
      { path: '/tenant-thing', router: okRouter(), scope: 'tenant' },
      {
        path: '/cross-thing',
        router: okRouter(),
        scope: 'crossTenant',
        reason: 'test fixture',
      },
    ],
    driverRouters: [],
    backgroundWorkers: [],
  } as unknown as Container;
  return createApp(container);
}

describe('tenant routers are mounted behind requireTenant', () => {
  it('refuses a tenant-less staff caller on a tenant router, even one without its own guard', async () => {
    const res = await request(appAs(staff)).get(`${API_VERSION_PREFIX}/tenant-thing/ping`);
    expect(res.status).toBe(403);
  });

  it('lets a staff caller reach a cross-tenant router', async () => {
    const res = await request(appAs(staff)).get(`${API_VERSION_PREFIX}/cross-thing/ping`);
    expect(res.status).toBe(200);
  });

  it('lets an org user reach a tenant router', async () => {
    const res = await request(appAs(orgUser)).get(`${API_VERSION_PREFIX}/tenant-thing/ping`);
    expect(res.status).toBe(200);
  });
});
