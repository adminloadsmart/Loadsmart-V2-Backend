import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { TruckTypeEntity } from './entities/truck-type.entity';
import { TruckTypeRepository } from './truck-type.repository';
import { CreateTruckTypeInput, TruckTypeWithVehicleCount } from './utils/truck-type.interface';

export class TruckTypeService {
  constructor(private readonly truckTypeRepository: TruckTypeRepository) {}

  async listTruckTypes(tenantId: string): Promise<TruckTypeWithVehicleCount[]> {
    try {
      return await this.truckTypeRepository.list(tenantId);
    } catch (error) {
      rethrow(error, 'Failed to list truck types');
    }
  }

  async createTruckType(
    tenantId: string,
    actorId: string,
    input: CreateTruckTypeInput,
  ): Promise<TruckTypeEntity> {
    try {
      const name = input.name.trim();

      const existing = await this.truckTypeRepository.findByName(tenantId, name);
      if (existing) {
        throw new ConflictError(`A truck type named "${name}" already exists`);
      }

      return await this.truckTypeRepository.create({ tenantId, name, createdBy: actorId });
    } catch (error) {
      rethrow(error, 'Failed to create truck type');
    }
  }

  async deleteTruckType(tenantId: string, actorId: string, truckTypeId: string): Promise<void> {
    try {
      const truckType = await this.assertTruckTypeExists(tenantId, truckTypeId);

      const inUse = await this.truckTypeRepository.countVehicles(tenantId, truckTypeId);
      if (inUse > 0) {
        throw new ConflictError(
          `Cannot delete truck type "${truckType.name}" — ${inUse} vehicle(s) still use it`,
        );
      }

      await this.truckTypeRepository.softDelete(tenantId, truckTypeId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete truck type');
    }
  }

  /** Shared by vehicle.service.ts to validate a `truckTypeId` before create/update. */
  async assertTruckTypeExists(tenantId: string, truckTypeId: string): Promise<TruckTypeEntity> {
    try {
      const truckType = await this.truckTypeRepository.findById(tenantId, truckTypeId);
      if (!truckType) throw new NotFoundError(`Truck type ${truckTypeId} not found`);
      return truckType;
    } catch (error) {
      rethrow(error, 'Failed to verify truck type exists');
    }
  }
}
