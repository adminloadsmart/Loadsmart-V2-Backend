import { DataSource, ILike, IsNull, Repository } from 'typeorm';
import { TransporterEntity } from './entities/transporter.entity';
import {
  CreateTransporterInput,
  ListTransportersInput,
  UpdateTransporterInput,
} from './utils/transporter.interface';

export class TransporterRepository {
  private readonly transporters: Repository<TransporterEntity>;
  constructor(dataSource: DataSource) {
    this.transporters = dataSource.getRepository(TransporterEntity);
  }

  create(
    data: CreateTransporterInput & { tenantId: string; createdBy: string },
  ): Promise<TransporterEntity> {
    return this.transporters.save(
      this.transporters.create({ ...data, deletedAt: null, updatedBy: null }),
    );
  }
  findById(tenantId: string, id: string) {
    return this.transporters.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }
  findByName(tenantId: string, name: string) {
    return this.transporters.findOneBy({ tenantId, name, deletedAt: IsNull() });
  }
  async list(tenantId: string, input: ListTransportersInput) {
    const where = input.search
      ? [{ tenantId, deletedAt: IsNull(), name: ILike(`%${input.search}%`) }]
      : [{ tenantId, deletedAt: IsNull() }];
    const [items, total] = await this.transporters.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    return { items, total };
  }
  async update(tenantId: string, id: string, data: UpdateTransporterInput & { updatedBy: string }) {
    await this.transporters.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id);
  }
  async softDelete(tenantId: string, id: string, updatedBy: string) {
    return this.transporters.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy },
    );
  }
}
