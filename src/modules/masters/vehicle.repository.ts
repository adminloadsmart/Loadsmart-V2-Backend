import { DataSource, EntityManager, FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import {
  CreateVehicleData,
  CreateVehicleDocumentData,
  ListVehiclesFilters,
  UpdateVehicleData,
  UpdateVehicleDocumentData,
} from './utils/vehicle.interface';

export class VehicleRepository {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly documents: Repository<VehicleDocumentEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.documents = dataSource.getRepository(VehicleDocumentEntity);
  }

  async create(data: CreateVehicleData, manager?: EntityManager): Promise<VehicleEntity> {
    const vehicles = manager ? manager.getRepository(VehicleEntity) : this.vehicles;
    const vehicle = vehicles.create({ ...data, deletedAt: null });
    return vehicles.save(vehicle);
  }

  findById(tenantId: string, id: string): Promise<VehicleEntity | null> {
    return this.vehicles.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findByIdWithRelations(tenantId: string, id: string): Promise<VehicleEntity | null> {
    return this.vehicles.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: { documents: true, driverLinks: { driver: true } },
    });
  }

  findByRegistrationNumber(tenantId: string, registrationNumber: string): Promise<VehicleEntity | null> {
    return this.vehicles.findOneBy({ tenantId, registrationNumber, deletedAt: IsNull() });
  }

  async list(tenantId: string, filters: ListVehiclesFilters): Promise<{ items: VehicleEntity[]; total: number }> {
    const { status, search, page, limit } = filters;

    const base: FindOptionsWhere<VehicleEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;

    // Search spans two columns, so it becomes two OR'd where-clauses rather than one.
    const where: FindOptionsWhere<VehicleEntity>[] = search
      ? [
        { ...base, registrationNumber: ILike(`%${search}%`) },
        { ...base, model: ILike(`%${search}%`) },
      ]
      : [base];

    const [items, total] = await this.vehicles.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async update(tenantId: string, id: string, data: UpdateVehicleData): Promise<VehicleEntity | null> {
    await this.vehicles.update({ id, tenantId, deletedAt: IsNull() }, data);
    return this.findById(tenantId, id);
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.vehicles.update({ id, tenantId, deletedAt: IsNull() }, { deletedAt: new Date(), updatedBy: deletedBy });
  }

  async createDocument(data: CreateVehicleDocumentData): Promise<VehicleDocumentEntity> {
    const document = this.documents.create({ ...data, deletedAt: null });
    return this.documents.save(document);
  }

  findDocumentById(tenantId: string, vehicleId: string, id: string): Promise<VehicleDocumentEntity | null> {
    return this.documents.findOneBy({ id, vehicleId, tenantId, deletedAt: IsNull() });
  }

  listDocuments(tenantId: string, vehicleId: string): Promise<VehicleDocumentEntity[]> {
    return this.documents.find({
      where: { tenantId, vehicleId, deletedAt: IsNull() },
      order: { expiryDate: 'ASC' },
    });
  }

  async updateDocument(
    tenantId: string,
    vehicleId: string,
    id: string,
    data: UpdateVehicleDocumentData,
  ): Promise<VehicleDocumentEntity | null> {
    await this.documents.update({ id, vehicleId, tenantId, deletedAt: IsNull() }, data);
    return this.findDocumentById(tenantId, vehicleId, id);
  }

  async softDeleteDocument(tenantId: string, vehicleId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.documents.update(
      { id, vehicleId, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }
}
