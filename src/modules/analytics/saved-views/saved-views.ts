import { Request, Response, Router } from 'express';
import { DataSource, Repository } from 'typeorm';
import { z } from 'zod';
import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import {
  requireTenant,
  requireTenantId,
} from '../../../shared/middleware/require-tenant.middleware';
import { validate } from '../../../shared/middleware/validate.middleware';
import { respond } from '../../../shared/responses/respond';
import { SavedViewEntity } from './saved-view.entity';

// Named filter views for the analytics screens (Shipper Analytics §6: "Filters can be saved as a
// named view"). A view belongs to the user who saved it, on one screen (`module`).

export const SAVED_VIEW_MODULES = ['shipper'] as const;
export type SavedViewModule = (typeof SAVED_VIEW_MODULES)[number];

/** At most this many views per user and screen. */
const MAX_VIEWS = 50;

export interface SavedViewDto {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  createdAt: Date;
}

const toDto = (view: SavedViewEntity): SavedViewDto => ({
  id: view.id,
  name: view.name,
  filters: view.filters,
  createdAt: view.createdAt,
});

export class SavedViewsService {
  private readonly views: Repository<SavedViewEntity>;

  constructor(dataSource: DataSource) {
    this.views = dataSource.getRepository(SavedViewEntity);
  }

  async list(tenantId: string, userId: string, module: SavedViewModule): Promise<SavedViewDto[]> {
    try {
      const views = await this.views.find({
        where: { tenantId, userId, module },
        order: { createdAt: 'DESC' },
      });
      return views.map(toDto);
    } catch (error) {
      rethrow(error, 'Failed to list saved views');
    }
  }

  async create(
    tenantId: string,
    userId: string,
    input: { module: SavedViewModule; name: string; filters: Record<string, unknown> },
  ): Promise<SavedViewDto> {
    try {
      const where = { tenantId, userId, module: input.module };
      if ((await this.views.count({ where })) >= MAX_VIEWS) {
        throw new ConflictError(`You can keep up to ${MAX_VIEWS} saved views`);
      }
      if (await this.views.exists({ where: { ...where, name: input.name } })) {
        throw new ConflictError(`A view named "${input.name}" already exists`);
      }
      const view = await this.views.save(this.views.create({ ...where, ...input }));
      return toDto(view);
    } catch (error) {
      rethrow(error, 'Failed to save the view');
    }
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    try {
      const result = await this.views.delete({ id, tenantId, userId });
      if (!result.affected) throw new NotFoundError(`Saved view ${id} not found`);
    } catch (error) {
      rethrow(error, 'Failed to delete the view');
    }
  }
}

const moduleSchema = z.enum(SAVED_VIEW_MODULES);

export const savedViewValidators = {
  list: z.object({ query: z.object({ module: moduleSchema }) }),
  create: z.object({
    body: z
      .object({
        module: moduleSchema,
        name: z.string().trim().min(1).max(80),
        // The analytics query params, as sent to the tab endpoints.
        filters: z.record(z.string(), z.union([z.string().max(200), z.null()])),
      })
      .strict(),
  }),
  remove: z.object({ params: z.object({ viewId: z.string().uuid() }) }),
};

export function createSavedViewRoutes(service: SavedViewsService): Router {
  const router = Router();
  router.use(requireTenant);
  router.get(
    '/saved-views',
    validate(savedViewValidators.list),
    asyncHandler(async (req: Request, res: Response) => {
      const { module } = req.validatedQuery as { module: SavedViewModule };
      respond(res, await service.list(requireTenantId(req), req.user!.id, module));
    }),
  );
  router.post(
    '/saved-views',
    validate(savedViewValidators.create),
    asyncHandler(async (req: Request, res: Response) => {
      respond(res, await service.create(requireTenantId(req), req.user!.id, req.body), 201);
    }),
  );
  router.delete(
    '/saved-views/:viewId',
    validate(savedViewValidators.remove),
    asyncHandler(async (req: Request<{ viewId: string }>, res: Response) => {
      await service.remove(requireTenantId(req), req.user!.id, req.params.viewId);
      respond(res, { deleted: true });
    }),
  );
  return router;
}
