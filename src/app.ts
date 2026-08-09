import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { Container } from './composition-root';
import { env } from './config/env';
import { API_VERSION_PREFIX } from './shared/constants/api';
import { errorHandler } from './shared/middleware/error-handler.middleware';
import { requestId } from './shared/middleware/request-id.middleware';
import { createTenantScope } from './shared/middleware/tenant-scope.middleware';
import { createDocsRouter } from './shared/openapi/docs';

export function createApp({
  tenancyGateway,
  authMiddleware,
  auditMiddleware,
  publicRouters,
  authenticatedRouters,
  routers,
}: Container): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json());

  app.use(requestId);

  // Ahead of auth: health checks must stay reachable without a token.
  app.get('/health', (_req, res) => {
    res.status(200).json({ data: { status: 'ok' } });
  });

  // Also ahead of auth, and only outside production: Swagger UI/spec must load without a
  // token, and must not exist as a route at all once NODE_ENV=production.
  if (env.nodeEnv !== 'production') {
    app.use('/docs', createDocsRouter());
  }

  // Also ahead of auth: you can't have a bearer token before /v1/auth/login issues one.
  // Every module's routes are mounted under API_VERSION_PREFIX here — the single point where
  // versioning is applied, so composition-root.ts's Container paths stay version-agnostic
  // ('/auth', '/masters', ...) and each module's *.openapi.ts BASE constant is the only other
  // place that needs to know about it (its registered paths must match these real mounts).
  for (const { path, router } of publicRouters) {
    app.use(`${API_VERSION_PREFIX}${path}`, router);
  }

  app.use(authMiddleware);
  // Ahead of tenant-scope: every authenticated request should be audited, not just the ones
  // that reach a tenant-scoped router — otherwise the authenticatedRouters tier below (logout,
  // deleteAccount, org bootstrap) would respond and return before ever reaching this middleware.
  app.use(auditMiddleware);

  // Authenticated, but the caller may not have a tenant yet (or the route doesn't need one) —
  // see composition-root.ts's Container.authenticatedRouters for why this exists.
  for (const { path, router } of authenticatedRouters) {
    app.use(`${API_VERSION_PREFIX}${path}`, router);
  }

  app.use(createTenantScope(tenancyGateway));
  // require-permission.middleware's requirePermission(...) is applied per-route by each module, not globally.

  for (const { path, router } of routers) {
    app.use(`${API_VERSION_PREFIX}${path}`, router);
  }

  app.use(errorHandler);

  return app;
}
