import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { ProductEntity } from './entities/product.entity';
import { ProductSubItemEntity } from './entities/product-sub-item.entity';
import { ListProductsInput } from './utils/product.interface';

export class ProductRepository {
  private readonly products: Repository<ProductEntity>;
  private readonly subItems: Repository<ProductSubItemEntity>;
  constructor(private readonly dataSource: DataSource) {
    this.products = dataSource.getRepository(ProductEntity);
    this.subItems = dataSource.getRepository(ProductSubItemEntity);
  }
  async create(
    data: Partial<ProductEntity>,
    subItems: string[],
    actorId: string,
  ): Promise<ProductEntity> {
    return this.dataSource.transaction(async (manager) => {
      const product = await manager
        .getRepository(ProductEntity)
        .save(manager.getRepository(ProductEntity).create({ ...data, deletedAt: null }));
      if (subItems.length)
        await manager.getRepository(ProductSubItemEntity).save(
          subItems.map((name) => ({
            productId: product.id,
            tenantId: product.tenantId,
            name,
            createdBy: actorId,
            deletedAt: null,
            deletedBy: null,
          })),
        );
      return this.findById(product.tenantId, product.id, manager) as Promise<ProductEntity>;
    });
  }
  findById(tenantId: string, id: string, manager?: EntityManager) {
    return (manager?.getRepository(ProductEntity) ?? this.products).findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { subItems: true },
    });
  }
  async list(tenantId: string, input: ListProductsInput): Promise<[ProductEntity[], number]> {
    const qb = this.products
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.subItems', 'subItem', 'subItem.deleted_at IS NULL')
      .where('product.tenant_id = :tenantId AND product.deleted_at IS NULL', { tenantId });
    if (input.status) qb.andWhere('product.status = :status', { status: input.status });
    if (input.approvalStatus)
      qb.andWhere('product.approval_status = :approvalStatus', {
        approvalStatus: input.approvalStatus,
      });
    if (input.search)
      qb.andWhere(
        '(product.product_details ILIKE :search OR product.hsn_code ILIKE :search OR subItem.name ILIKE :search)',
        { search: `%${input.search}%` },
      );
    qb.orderBy('product.created_at', 'DESC')
      .skip((input.page - 1) * input.limit)
      .take(input.limit)
      .distinct(true);
    return qb.getManyAndCount();
  }
  async update(
    tenantId: string,
    id: string,
    data: Partial<ProductEntity>,
    changes: { add?: string[]; update?: { id: string; name: string }[]; remove?: string[] },
    actorId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(ProductEntity);
      const itemRepo = manager.getRepository(ProductSubItemEntity);
      await productRepo.update(
        { id, tenantId, deletedAt: IsNull() },
        { ...data, updatedAt: new Date() },
      );
      if (changes.add?.length)
        await itemRepo.save(
          changes.add.map((name) => ({
            productId: id,
            tenantId,
            name,
            createdBy: actorId,
            deletedAt: null,
            deletedBy: null,
          })),
        );
      for (const item of changes.update ?? []) {
        const result = await itemRepo.update(
          { id: item.id, productId: id, tenantId, deletedAt: IsNull() },
          { name: item.name },
        );
        if (!result.affected) throw new Error(`Sub-item ${item.id} not found`);
      }
      if (changes.remove?.length)
        await itemRepo.update(
          { id: In(changes.remove), productId: id, tenantId, deletedAt: IsNull() },
          { deletedAt: new Date(), deletedBy: actorId },
        );
      return this.findById(tenantId, id, manager);
    });
  }
  async transition(tenantId: string, id: string, data: Partial<ProductEntity>) {
    const result = await this.products.update(
      { id, tenantId, deletedAt: IsNull(), approvalStatus: 'pending_approval' },
      data,
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }
  async softDelete(tenantId: string, id: string, actorId: string) {
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      await manager
        .getRepository(ProductEntity)
        .update(
          { id, tenantId, deletedAt: IsNull() },
          { deletedAt: now, deletedBy: actorId, status: 'inactive' },
        );
      await manager
        .getRepository(ProductSubItemEntity)
        .update(
          { productId: id, tenantId, deletedAt: IsNull() },
          { deletedAt: now, deletedBy: actorId },
        );
    });
  }
}
