import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { CreateProductInput, ListProductsInput, UpdateProductInput } from './product.interface';
import { ProductService } from './product.service';

export class ProductController {
  constructor(private readonly productService: ProductService) {}

  listProducts = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.list(requireTenantId(req), req.validatedQuery as ListProductsInput),
    );
  getProduct = async (req: Request, res: Response) =>
    respond(res, await this.productService.get(requireTenantId(req), String(req.params.productId)));
  createProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.create(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body as CreateProductInput,
      ),
      201,
    );
  updateProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.update(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body as UpdateProductInput,
      ),
    );
  approveProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.approve(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
      ),
    );
  rejectProduct = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.reject(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body.reason,
      ),
    );
  deleteProduct = async (req: Request, res: Response) => {
    await this.productService.delete(
      requireTenantId(req),
      req.user!.id,
      String(req.params.productId),
    );
    respond(res, { success: true });
  };
  setProductStatus = async (req: Request, res: Response) =>
    respond(
      res,
      await this.productService.setStatus(
        requireTenantId(req),
        req.user!.id,
        String(req.params.productId),
        req.body.status,
      ),
    );
}
