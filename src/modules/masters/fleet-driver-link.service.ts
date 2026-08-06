import { DataSource } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { FleetDriverLinkEntity } from './entities/fleet-driver-link.entity';
import { FleetDriverLinkRepository } from './fleet-driver-link.repository';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { toDateString } from './utils/masters.types';
import { LinkDriverInput } from './utils/fleet-driver-link.interface';

export class FleetDriverLinkService {
  constructor(
    private readonly linkRepository: FleetDriverLinkRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly dataSource: DataSource,
  ) { }

  async linkDriver(tenantId: string, actorId: string, vehicleId: string, input: LinkDriverInput): Promise<FleetDriverLinkEntity> {
    try {
      await this.vehicleService.assertVehicleExists(tenantId, vehicleId);
      const driver = await this.driverService.assertDriverExists(tenantId, input.driverId);

      if (driver.status !== 'active') {
        throw new ValidationError(`Driver ${driver.id} is ${driver.status} and cannot be assigned to a vehicle`);
      }

      const existing = await this.linkRepository.findActiveLink(tenantId, vehicleId, input.driverId);
      if (existing) {
        throw new ConflictError('This driver is already assigned to the vehicle');
      }

      const isPrimary = input.isPrimary ?? true;
      const linkedFrom = input.linkedFrom ?? toDateString(new Date());

      return await this.dataSource.transaction(async (manager) => {
        // At most one primary driver per vehicle, so the incoming primary demotes the incumbent.
        if (isPrimary) {
          await this.linkRepository.demoteOtherPrimaryLinks(tenantId, vehicleId, null, actorId, manager);
        }

        return this.linkRepository.create(
          { tenantId, vehicleId, driverId: input.driverId, isPrimary, linkedFrom, createdBy: actorId },
          manager,
        );
      });
    } catch (error) {
      rethrow(error, 'Failed to link driver to vehicle');
    }
  }

  async listVehicleLinks(tenantId: string, vehicleId: string): Promise<FleetDriverLinkEntity[]> {
    try {
      await this.vehicleService.assertVehicleExists(tenantId, vehicleId);
      return await this.linkRepository.listByVehicle(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to list vehicle links');
    }
  }

  async listDriverLinks(tenantId: string, driverId: string): Promise<FleetDriverLinkEntity[]> {
    try {
      await this.driverService.assertDriverExists(tenantId, driverId);
      return await this.linkRepository.listByDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver links');
    }
  }

  async setPrimary(tenantId: string, actorId: string, linkId: string): Promise<FleetDriverLinkEntity> {
    try {
      const existing = await this.getActiveLink(tenantId, linkId);

      return await this.dataSource.transaction(async (manager) => {
        await this.linkRepository.demoteOtherPrimaryLinks(tenantId, existing.vehicleId, linkId, actorId, manager);

        const link = await this.linkRepository.update(tenantId, linkId, { isPrimary: true, updatedBy: actorId }, manager);
        if (!link) throw new NotFoundError(`Fleet driver link ${linkId} not found`);
        return link;
      });
    } catch (error) {
      rethrow(error, 'Failed to set primary driver link');
    }
  }

  async endLink(tenantId: string, actorId: string, linkId: string, linkedTo?: string): Promise<FleetDriverLinkEntity> {
    try {
      await this.getActiveLink(tenantId, linkId);

      const link = await this.linkRepository.update(tenantId, linkId, {
        status: 'ended',
        isPrimary: false,
        linkedTo: linkedTo ?? toDateString(new Date()),
        updatedBy: actorId,
      });
      if (!link) throw new NotFoundError(`Fleet driver link ${linkId} not found`);
      return link;
    } catch (error) {
      rethrow(error, 'Failed to end driver link');
    }
  }

  async deleteLink(tenantId: string, actorId: string, linkId: string): Promise<void> {
    try {
      const link = await this.linkRepository.findById(tenantId, linkId);
      if (!link) throw new NotFoundError(`Fleet driver link ${linkId} not found`);
      await this.linkRepository.softDelete(tenantId, linkId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete driver link');
    }
  }

  private async getActiveLink(tenantId: string, linkId: string): Promise<FleetDriverLinkEntity> {
    try {
      const link = await this.linkRepository.findById(tenantId, linkId);
      if (!link) throw new NotFoundError(`Fleet driver link ${linkId} not found`);
      if (link.status !== 'active') {
        throw new ValidationError(`Fleet driver link ${linkId} has already ended`);
      }
      return link;
    } catch (error) {
      rethrow(error, 'Failed to verify fleet driver link is active');
    }
  }
}
