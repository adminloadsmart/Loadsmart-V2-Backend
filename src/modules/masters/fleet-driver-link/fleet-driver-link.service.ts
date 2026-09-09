import { DataSource, EntityManager } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../../shared/errors';
import { toDateString } from '../../../shared/utils/date';
import { humanizeStatus } from '../../../shared/utils/humanize';
import { FleetDriverLinkEntity } from './entities/fleet-driver-link.entity';
import { FleetDriverLinkRepository } from './fleet-driver-link.repository';
import { VehicleRepository } from '../vehicle/vehicle.repository';
import { DriverRepository } from '../driver/driver.repository';
import { LinkDriverInput } from './fleet-driver-link.interface';

/**
 * Depends on the vehicle/driver repositories rather than their services: VehicleService.onboardVehicle
 * calls into this service to link a driver inside the same transaction (see its `driverLink` handling),
 * so this can't depend back on VehicleService without a constructor cycle. The existence checks below
 * are the same ones VehicleService/DriverService would otherwise have done on our behalf.
 */
export class FleetDriverLinkService {
  constructor(
    private readonly linkRepository: FleetDriverLinkRepository,
    private readonly vehicleRepository: VehicleRepository,
    private readonly driverRepository: DriverRepository,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Pass `outerManager` to run inside a caller's transaction (e.g. vehicle onboarding), so the link
   * commits or rolls back with the rest of that unit of work instead of as its own transaction.
   */
  async linkDriver(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    input: LinkDriverInput,
    outerManager?: EntityManager,
  ): Promise<FleetDriverLinkEntity> {
    try {
      const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId, outerManager);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);

      const driver = await this.driverRepository.findById(tenantId, input.driverId, outerManager);
      if (!driver) throw new NotFoundError(`Driver ${input.driverId} not found`);

      if (driver.status !== 'active') {
        throw new ValidationError(
          `Driver ${driver.fullName} is ${humanizeStatus(driver.status)} and cannot be assigned to a vehicle`,
        );
      }

      const existing = await this.linkRepository.findActiveLink(
        tenantId,
        vehicleId,
        input.driverId,
        outerManager,
      );
      if (existing) {
        throw new ConflictError('This driver is already assigned to the vehicle');
      }

      const isPrimary = input.isPrimary ?? true;
      const linkedFrom = input.linkedFrom ?? toDateString(new Date());

      const run = async (manager: EntityManager) => {
        // At most one primary driver per vehicle, so the incoming primary demotes the incumbent.
        if (isPrimary) {
          await this.linkRepository.demoteOtherPrimaryLinks(
            tenantId,
            vehicleId,
            null,
            actorId,
            manager,
          );
        }

        return this.linkRepository.create(
          {
            tenantId,
            vehicleId,
            driverId: input.driverId,
            isPrimary,
            linkedFrom,
            createdBy: actorId,
          },
          manager,
        );
      };

      return outerManager ? await run(outerManager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to link driver to vehicle');
    }
  }

  /**
   * Backs the "Linked driver" dropdown on the edit-vehicle form: idempotently makes `driverId` the
   * vehicle's primary driver. If a different driver currently holds the primary slot, that link is
   * ended (not deleted — the assignment history stays); if `driverId` already is the primary driver,
   * this is a no-op. Pass `outerManager` to run inside VehicleService.updateVehicle's transaction, so
   * the field changes and the driver swap commit or roll back together.
   */
  async setPrimaryDriver(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    driverId: string,
    outerManager?: EntityManager,
  ): Promise<FleetDriverLinkEntity> {
    try {
      const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId, outerManager);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);

      const driver = await this.driverRepository.findById(tenantId, driverId, outerManager);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);

      if (driver.status !== 'active') {
        throw new ValidationError(
          `Driver ${driver.fullName} is ${humanizeStatus(driver.status)} and cannot be assigned to a vehicle`,
        );
      }

      const run = async (manager: EntityManager) => {
        const currentPrimary = await this.linkRepository.findActivePrimaryLink(
          tenantId,
          vehicleId,
          manager,
        );

        if (currentPrimary?.driverId === driverId) {
          return currentPrimary;
        }

        if (currentPrimary) {
          await this.linkRepository.update(
            tenantId,
            currentPrimary.id,
            {
              status: 'ended',
              isPrimary: false,
              linkedTo: toDateString(new Date()),
              updatedBy: actorId,
            },
            manager,
          );
        }

        // The incoming driver might already hold a non-primary link on this vehicle (a co-driver
        // being promoted) — reuse that row instead of creating a duplicate active link.
        const existingSecondary = await this.linkRepository.findActiveLink(
          tenantId,
          vehicleId,
          driverId,
          manager,
        );
        if (existingSecondary) {
          const promoted = await this.linkRepository.update(
            tenantId,
            existingSecondary.id,
            { isPrimary: true, updatedBy: actorId },
            manager,
          );
          return promoted!;
        }

        return this.linkRepository.create(
          {
            tenantId,
            vehicleId,
            driverId,
            isPrimary: true,
            linkedFrom: toDateString(new Date()),
            createdBy: actorId,
          },
          manager,
        );
      };

      return outerManager ? await run(outerManager) : await this.dataSource.transaction(run);
    } catch (error) {
      rethrow(error, 'Failed to set primary driver');
    }
  }

  async listVehicleLinks(tenantId: string, vehicleId: string): Promise<FleetDriverLinkEntity[]> {
    try {
      const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return await this.linkRepository.listByVehicle(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to list vehicle links');
    }
  }

  async listDriverLinks(tenantId: string, driverId: string): Promise<FleetDriverLinkEntity[]> {
    try {
      const driver = await this.driverRepository.findById(tenantId, driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return await this.linkRepository.listByDriver(tenantId, driverId);
    } catch (error) {
      rethrow(error, 'Failed to list driver links');
    }
  }

  async setPrimary(
    tenantId: string,
    actorId: string,
    linkId: string,
  ): Promise<FleetDriverLinkEntity> {
    try {
      const existing = await this.getActiveLink(tenantId, linkId);

      return await this.dataSource.transaction(async (manager) => {
        await this.linkRepository.demoteOtherPrimaryLinks(
          tenantId,
          existing.vehicleId,
          linkId,
          actorId,
          manager,
        );

        const link = await this.linkRepository.update(
          tenantId,
          linkId,
          { isPrimary: true, updatedBy: actorId },
          manager,
        );
        if (!link) throw new NotFoundError(`Fleet driver link ${linkId} not found`);
        return link;
      });
    } catch (error) {
      rethrow(error, 'Failed to set primary driver link');
    }
  }

  async endLink(
    tenantId: string,
    actorId: string,
    linkId: string,
    linkedTo?: string,
  ): Promise<FleetDriverLinkEntity> {
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
