import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry, TAGS } from './core';
import { registerAuthOpenApi } from '../../modules/auth/auth.openapi';
import { registerRoleOpenApi } from '../../modules/roles/role.openapi';
import { registerMastersOpenApi } from '../../modules/masters/masters.openapi';
import { registerAdminOpenApi } from '../../modules/admin/admin.openapi';

/**
 * Builds the OpenAPI document (once, cached) and serves it as Swagger UI. Mounted only
 * outside production — see app.ts. The only export used elsewhere is `createDocsRouter`.
 */

// Bump manually alongside meaningful API surface changes. Not read from package.json:
// that import would resolve outside tsconfig.json's rootDir ("src") and fail `tsc -p tsconfig.json`.
const API_VERSION = '0.1.0';

let cached: ReturnType<OpenApiGeneratorV31['generateDocument']> | undefined;

/**
 * The exhaustive list of what's currently documented — auth, roles, masters, and admin are the
 * only modules with real routes/validators today. Explicit calls (not side-effect imports) so a
 * module that's forgotten here is a visible missing line, not a silently empty tag in the UI.
 * Future module: add its `register<Name>OpenApi(registry)` call here + a tag below.
 */
function getOpenApiDocument() {
  if (!cached) {
    registerAuthOpenApi(registry);
    registerRoleOpenApi(registry);
    registerMastersOpenApi(registry);
    registerAdminOpenApi(registry);

    cached = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: {
        title: 'Loadsmart API',
        version: API_VERSION,
        description:
          'Multi-tenant logistics/fleet SaaS API. Every route requires a bearer JWT unless explicitly marked public.',
      },
      tags: [
        { name: TAGS.AUTH, description: 'Signup, login, session, and organization management' },
        { name: TAGS.ROLES, description: 'Role assignment and permission grants for users' },
        {
          name: TAGS.MASTERS,
          description: 'Vehicles, drivers, documents, verifications, and fleet-driver links',
        },
        {
          name: TAGS.ADMIN,
          description: 'Platform-admin operations on organizations (status, document verification)',
        },
      ],
    });
  }

  return cached;
}

export function createDocsRouter(): Router {
  const router = Router();
  const document = getOpenApiDocument();

  // helmet()'s default CSP (app.ts) blocks swagger-ui-bundle.js's eval-like init code,
  // which renders as a silent blank page with no visible error. This router is dev/staging-only
  // (see the NODE_ENV gate in app.ts), so relaxing CSP just here is a scoped, low-risk
  // trade-off — every real API route keeps the strict default untouched.
  router.use((_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
  });

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Loadsmart API Docs',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  return router;
}
