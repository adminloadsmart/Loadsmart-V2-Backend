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
      this.transporters.create({
        tenantId: data.tenantId,
        createdBy: data.createdBy,
        name: data.name,
        phone: data.phone,
        rate: data.rate ?? null,
        email: data.email ?? null,
        gstin: data.gstin ?? null,
        msmeRegistration: data.msmeRegistration ?? null,
        companyType: data.companyType ?? null,
        status: data.status ?? 'active',
        advancePercentage: data.advancePercentage?.toString() ?? null,
        creditDays: data.creditDays ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        landmark: data.landmark ?? null,
        areaLocality: data.areaLocality ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pinCode: data.pinCode ?? null,
        bankAccountNumber: data.bankAccountNumber ?? null,
        bankIfsc: data.bankIfsc ?? null,
        bankAccountHolderName: data.bankAccountHolderName ?? null,
        deletedAt: null,
        updatedBy: null,
      }),
    );
  }
  findById(tenantId: string, id: string) {
    return this.transporters.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }
  findByPhone(tenantId: string, phone: string) {
    return this.transporters.findOneBy({ tenantId, phone, deletedAt: IsNull() });
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
    const { advancePercentage, ...rest } = data;
    await this.transporters.update(
      { id, tenantId, deletedAt: IsNull() },
      {
        ...rest,
        advancePercentage:
          advancePercentage === undefined || advancePercentage === null
            ? advancePercentage
            : advancePercentage.toString(),
      },
    );
    return this.findById(tenantId, id);
  }
  async softDelete(tenantId: string, id: string, updatedBy: string) {
    return this.transporters.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy },
    );
  }
}
