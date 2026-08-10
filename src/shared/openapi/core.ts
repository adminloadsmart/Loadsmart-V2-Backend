import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z, ZodTypeAny } from 'zod';

/**
 * Shared OpenAPI infra: the registry every module's `*.openapi.ts` registers against, the
 * bearer-auth security scheme, helpers for the app's three route-protection tiers, and the
 * two response envelope shapes used by the whole API. See `docs.ts` for where this becomes
 * the final spec + Swagger UI.
 */

export const registry = new OpenAPIRegistry();

/** One tag per documented module. Mirrors the mount paths in composition-root.ts. */
export const TAGS = {
  AUTH: 'auth',
  ROLES: 'roles',
  MASTERS: 'masters',
  ADMIN: 'admin',
  DASHBOARDS: 'dashboards',
} as const;

/**
 * The API has exactly one auth scheme: a bearer JWT, verified in
 * `shared/middleware/auth.middleware.ts` and required by everything except
 * `publicRouters` and `/health`.
 */
const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Obtain via POST /v1/auth/login, /v1/auth/verify-otp, or /v1/auth/refresh. Send as `Authorization: Bearer <token>`.',
});

/**
 * Maps the app's three real route-protection tiers (see auth.routes.ts / masters.routes.ts)
 * onto OpenAPI operation fields. Public routes need neither helper — just omit `security`.
 */
export const authenticated = (description: string) => ({
  security: [{ [bearerAuth.name]: [] }],
  description,
});

/**
 * `requirePermission(...permissions)` (shared/middleware/require-permission.middleware.ts) also
 * always allows platform_admin as an implicit superuser — call that out so it isn't a surprise
 * to a reader. OpenAPI has no native RBAC concept, so the requirement is documented two ways:
 * human-readable text in `description` (renders in Swagger UI) and the `x-required-permissions`
 * vendor extension (machine-readable, for any future tooling).
 */
export const permissionGated = (permissions: string[], description: string) => ({
  security: [{ [bearerAuth.name]: [] }],
  description: `${description}\n\nRequires permission: ${permissions.join(' or ')} (platform_admin always allowed).`,
  'x-required-permissions': permissions,
});

/**
 * Response *bodies* aren't documented beyond these two fixed, stable envelopes — success
 * payloads (the actual vehicle/driver/organization/etc. shape returned) aren't schema'd, so
 * successful non-delete responses show only a status code + description in the UI, no
 * example body. Unlike request shapes (enforced by `validate()`, guaranteed accurate),
 * response shapes are never enforced at runtime, so hand-written response schemas would be
 * free to drift from the real entities as they evolve — not worth it for what they'd add.
 *
 *   error   -> { error: { code, message, details? } }  (shared/middleware/error-handler.middleware.ts)
 *   success -> { success: true }, on every delete endpoint only (shared/responses/respond.ts)
 *
 * Named via Zod v4's native `.meta({ id })` rather than `registry.register()` — `.meta()` is
 * all the generator needs to name a component; `registry.register()` requires
 * `extendZodWithOpenApi`, which this codebase deliberately doesn't call (so nothing needs to
 * remember to trigger it, and validators.ts files never gain an openapi-only import).
 */

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

/** Every delete endpoint in auth/masters returns exactly this via respond(res, { success: true }). */
export const SuccessResponseSchema = z
  .object({ success: z.literal(true) })
  .meta({ id: 'SuccessResponse' });

/** Small helper used by every module's *.openapi.ts to build a JSON request/response body. */
export const json = <T extends ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});

// Built from `json()` deliberately — an ad-hoc `{ 'application/json': {...} }` object here
// (missing the `content` wrapper `json()` adds) type-checked fine under `{ ...errorContent }`
// spreads (TS doesn't excess-check spread-merged properties) but produced a malformed
// response at runtime: the generator never recognized it as a schema to convert, and the raw
// Zod schema internals got serialized as-is into the spec — reproduced on every 4xx/5xx
// response across the whole API before this was caught.
export const errorContent = json(ErrorResponseSchema);
