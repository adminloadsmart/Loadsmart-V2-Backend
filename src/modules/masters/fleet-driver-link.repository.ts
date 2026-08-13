import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { FleetDriverLinkEntity } from './entities/fleet-driver-link.entity';
import {
  CreateFleetDriverLinkData,
  UpdateFleetDriverLinkData,
} from './utils/fleet-driver-link.interface';

export class FleetDriverLinkRepository {
  private readonly links: Repository<FleetDriverLinkEntity>;

  constructor(dataSource: DataSource) {
    this.links = dataSource.getRepository(FleetDriverLinkEntity);
  }

  async create(
    data: CreateFleetDriverLinkData,
    manager?: EntityManager,
  ): Promise<FleetDriverLinkEntity> {
    const links = manager ? manager.getRepository(FleetDriverLinkEntity) : this.links;
    const link = links.create({ ...data, linkedTo: null, status: 'active', deletedAt: null });
    return links.save(link);
  }

  findById(tenantId: string, id: string): Promise<FleetDriverLinkEntity | null> {
    return this.links.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  findActiveLink(
    tenantId: string,
    vehicleId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<FleetDriverLinkEntity | null> {
    const links = manager ? manager.getRepository(FleetDriverLinkEntity) : this.links;
    return links.findOneBy({
      tenantId,
      vehicleId,
      driverId,
      status: 'active',
      deletedAt: IsNull(),
    });
  }

  findActivePrimaryLink(
    tenantId: string,
    vehicleId: string,
    manager?: EntityManager,
  ): Promise<FleetDriverLinkEntity | null> {
    const links = manager ? manager.getRepository(FleetDriverLinkEntity) : this.links;
    return links.findOneBy({
      tenantId,
      vehicleId,
      status: 'active',
      isPrimary: true,
      deletedAt: IsNull(),
    });
  }

  listByVehicle(tenantId: string, vehicleId: string): Promise<FleetDriverLinkEntity[]> {
    return this.links.find({
      where: { tenantId, vehicleId, deletedAt: IsNull() },
      relations: { driver: true },
      order: { linkedFrom: 'DESC' },
    });
  }

  listByDriver(tenantId: string, driverId: string): Promise<FleetDriverLinkEntity[]> {
    return this.links.find({
      where: { tenantId, driverId, deletedAt: IsNull() },
      relations: { vehicle: true },
      order: { linkedFrom: 'DESC' },
    });
  }

  /** Demotes every other active link on the vehicle so at most one stays primary. */
  async demoteOtherPrimaryLinks(
    tenantId: string,
    vehicleId: string,
    exceptLinkId: string | null,
    updatedBy: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const links = manager ? manager.getRepository(FleetDriverLinkEntity) : this.links;
    await links.update(
      {
        tenantId,
        vehicleId,
        status: 'active',
        isPrimary: true,
        deletedAt: IsNull(),
        ...(exceptLinkId ? { id: Not(exceptLinkId) } : {}),
      },
      { isPrimary: false, updatedBy },
    );
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateFleetDriverLinkData,
    manager?: EntityManager,
  ): Promise<FleetDriverLinkEntity | null> {
    const links = manager ? manager.getRepository(FleetDriverLinkEntity) : this.links;
    await links.update({ id, tenantId, deletedAt: IsNull() }, data);
    return links.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  async softDelete(tenantId: string, id: string, deletedBy: string | null): Promise<void> {
    await this.links.update(
      { id, tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }
}
