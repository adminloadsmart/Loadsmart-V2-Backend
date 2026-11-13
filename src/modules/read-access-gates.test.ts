import { describe, expect, it } from 'vitest';
import express, { ErrorRequestHandler, Router } from 'express';
import request from 'supertest';
import { AppError } from '../shared/errors';
import { ROLES } from '../db/role-catalog';
import { createDriverRoutes } from './driver/driver.routes';
import { createVehicleRoutes } from './masters/vehicle/vehicle.routes';
import { createTransporterRoutes } from './masters/transporter/transporter.routes';
import { createContractRoutes } from './masters/contract/contract.routes';
import { createProductRoutes } from './masters/product/product.routes';
import { createLoadingPointRoutes } from './masters/loading-point/loading-point.routes';
import { createLoadsProtectedRoutes } from './loads/core/loads.routes';
import { createLoadsmartShipperRoutes } from './loadsmart-ops/loadsmart.routes';
import { createShipperAnalyticsRoutes } from './analytics/shipper/shipper-analytics.routes';

// The org roles' permission bundles exactly as db/seed-roles.ts seeds them.
const ORG_ROLES = ['sales_cs', 'dispatch', 'documents_ops', 'finance_accounts'] as const;
const SEEDED = Object.fromEntries(
  ORG_ROLES.map((name) => {
    const role = ROLES.find((r) => r.name === name);
    if (!role) throw new Error(`Role ${name} missing from db/role-catalog.ts`);
    return [name, role.permissionKeys];
  }),
) as Record<(typeof ORG_ROLES)[number], string[]>;
type OrgRole = keyof typeof SEEDED;

// Every controller method just answers 200 — these tests only care whether the gate let the
// request through.
const okController = new Proxy(
  {},
  { get: () => (_req: unknown, res: express.Response) => res.status(200).json({}) },
) as never;

const errors: ErrorRequestHandler = (err, _req, res, _next) => {
  res.status(err instanceof AppError ? err.statusCode : 500).json({ message: err.message });
};

function appFor(role: OrgRole, mount: (router: Router) => void) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = {
      id: 'user-1',
      tenantId: 'tenant-1',
      role,
      permissions: SEEDED[role],
      permissionsVersion: 1,
      portal: 'organization',
    };
    next();
  });
  const router = Router();
  mount(router);
  app.use(router);
  app.use(errors);
  return app;
}

const allRouters = (router: Router) => {
  router.use(createDriverRoutes(okController, okController));
  router.use(createVehicleRoutes(okController, okController));
  router.use(createTransporterRoutes(okController, okController));
  router.use(createContractRoutes(okController));
  router.use(createProductRoutes(okController, okController));
  router.use(createLoadingPointRoutes(okController, okController));
  router.use('/loads', createLoadsProtectedRoutes(okController));
  router.use('/loads', createLoadsmartShipperRoutes(okController));
  router.use('/analytics', createShipperAnalyticsRoutes(okController));
};

const ID = '00000000-0000-4000-8000-000000000001';

// [route, roles allowed through the gate] — every other org role must get a 403.
const GATED_READS: [string, OrgRole[]][] = [
  // Bank accounts — payments only.
  [`/drivers/${ID}/bank-details`, ['finance_accounts']],
  // Money.
  [`/loads/loads/${ID}/payments`, ['finance_accounts']],
  [`/loads/loads/${ID}/invoice`, ['finance_accounts']],
  [`/loads/loads/${ID}/charges`, ['finance_accounts', 'dispatch']],
  [`/loads/loads/${ID}/claim`, ['finance_accounts', 'dispatch']],
  ['/analytics/shipper/freight-spend', ['finance_accounts']],
  ['/analytics/shipper/billing', ['finance_accounts']],
  // Bulk exports — masters.write.
  ['/drivers/export', ['dispatch']],
  ['/vehicles/export', ['dispatch']],
  ['/transporters/export', ['dispatch']],
  ['/contracts/export', ['dispatch']],
  ['/products/export', ['dispatch']],
  ['/loading-points/export', ['dispatch']],
  // Requisitions — raised by sales_cs, planned by dispatch.
  ['/loads/requisitions', ['sales_cs', 'dispatch']],
  [`/loads/requisitions/${ID}`, ['sales_cs', 'dispatch']],
  [`/loads/requisitions/${ID}/available-vehicles`, ['sales_cs', 'dispatch']],
  // Fleet/driver detail — masters.write.
  [`/drivers/${ID}/documents`, ['dispatch']],
  [`/drivers/${ID}/verifications`, ['dispatch']],
  [`/drivers/${ID}/trip-metrics`, ['dispatch']],
  [`/vehicles/${ID}/documents`, ['dispatch']],
  [`/vehicles/${ID}/verifications`, ['dispatch']],
  [`/vehicles/${ID}/telemetry`, ['dispatch']],
];

describe('read access gates', () => {
  const roles = Object.keys(SEEDED) as OrgRole[];

  for (const [route, allowed] of GATED_READS) {
    for (const role of roles) {
      const expectAllowed = allowed.includes(role);
      it(`${role} ${expectAllowed ? 'passes' : 'is refused'} GET ${route}`, async () => {
        const res = await request(appFor(role, allRouters)).get(route);
        if (expectAllowed) expect(res.status).not.toBe(403);
        else expect(res.status).toBe(403);
      });
    }
  }

  it('leaves the vehicle and driver lists open to every org role (pickers need them)', async () => {
    for (const role of roles) {
      expect((await request(appFor(role, allRouters)).get('/vehicles')).status).not.toBe(403);
      expect((await request(appFor(role, allRouters)).get('/drivers')).status).not.toBe(403);
    }
  });
});
