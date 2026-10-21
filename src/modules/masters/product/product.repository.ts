import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { ProductEntity } from './entities/product.entity';
import { ProductSubItemEntity } from './entities/product-sub-item.entity';
import { ListProductsInput } from './product.interface';
import { UserEntity } from '../../auth/entities/user.entity';
import { LoadCargoItemEntity } from '../../loads/entities/load-cargo-item.entity';

/** A product plus its creator's name ("entered by Ritu · unverified"). */
export type ProductWithCreator = ProductEntity & {
  createdByUser?: Pick<UserEntity, 'id' | 'fullName'> | null;
};

export class ProductRepository {
  private readonly products: Repository<ProductEntity>;
  private readonly subItems: Repository<ProductSubItemEntity>;
  constructor(private readonly dataSource: DataSource) {
    this.products = dataSource.getRepository(ProductEntity);
    this.subItems = dataSource.getRepository(ProductSubItemEntity);
  }
  /** Bulk-upload duplicate check: same name (case-insensitive) and HSN (blank = none). */
  findByNameAndHsn(tenantId: string, productDetails: string, hsnCode?: string | null) {
    return this.products
      .createQueryBuilder('product')
      .where('product.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(TRIM(product.product_details)) = LOWER(TRIM(:name))', {
        name: productDetails,
      })
      .andWhere("COALESCE(product.hsn_code, '') = :hsn", { hsn: hsnCode?.trim() ?? '' })
      .andWhere('product.deleted_at IS NULL')
      .getOne();
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
  async list(tenantId: string, input: ListProductsInput): Promise<[ProductWithCreator[], number]> {
    const qb = this.products
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.subItems', 'subItem', 'subItem.deleted_at IS NULL')
      .leftJoinAndMapOne(
        'product.createdByUser',
        UserEntity,
        'creator',
        'creator.id = product.created_by',
      )
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
  /** "Moved (6 mo)" — tonnes loaded per product over the last six months, keyed by product id. */
  async movedTonnesSince(
    tenantId: string,
    productIds: string[],
    since: Date,
  ): Promise<Map<string, string>> {
    if (!productIds.length) return new Map();
    const rows = await this.dataSource
      .getRepository(LoadCargoItemEntity)
      .createQueryBuilder('item')
      .innerJoin('item.load', 'load')
      .select('item.product_id', 'productId')
      .addSelect('COALESCE(SUM(item.tonnes_per_truck), 0)', 'tonnes')
      .where('item.tenant_id = :tenantId AND item.product_id IN (:...productIds)', {
        tenantId,
        productIds,
      })
      .andWhere('load.created_at >= :since', { since })
      .groupBy('item.product_id')
      .getRawMany<{ productId: string; tonnes: string }>();
    return new Map(rows.map((row) => [row.productId, Number(row.tonnes).toFixed(2)]));
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
