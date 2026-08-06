import { ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehicleDocumentEntity } from './entities/vehicle-document.entity';
import { VehicleDocumentStatus } from './utils/vehicle.type';
import { VehicleRepository } from './vehicle.repository';
import { DOCUMENT_EXPIRING_SOON_DAYS } from './masters.constants';
import { Paginated, paginate } from './utils/masters.types';
import { AddVehicleDocumentInput, CreateVehicleInput, ListVehiclesInput, UpdateVehicleDocumentInput, UpdateVehicleInput } from './utils/vehicle.interface';

/** Derives the document's lifecycle state from its expiry date; undated documents stay `valid`. */
export function resolveDocumentStatus(expiryDate: string | null): VehicleDocumentStatus {
  if (!expiryDate) return 'valid';

  const expiry = new Date(`${expiryDate}T00:00:00.000Z`);
  const now = new Date();
  const daysRemaining = Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= DOCUMENT_EXPIRING_SOON_DAYS) return 'expiring_soon';
  return 'valid';
}

export class VehicleService {
  constructor(private readonly vehicleRepository: VehicleRepository) { }

  async createVehicle(tenantId: string, actorId: string, input: CreateVehicleInput): Promise<VehicleEntity> {
    try {
      const registrationNumber = input.registrationNumber.toUpperCase();

      const existing = await this.vehicleRepository.findByRegistrationNumber(tenantId, registrationNumber);
      if (existing) {
        throw new ConflictError(`A vehicle with registration number ${registrationNumber} already exists`);
      }

      return await this.vehicleRepository.create({
        tenantId,
        registrationNumber,
        vehicleType: input.vehicleType ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        capacityTons: input.capacityTons === undefined ? null : String(input.capacityTons),
        ownershipType: input.ownershipType ?? 'owned',
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to create vehicle');
    }
  }

  async listVehicles(tenantId: string, input: ListVehiclesInput): Promise<Paginated<VehicleEntity>> {
    try {
      const { items, total } = await this.vehicleRepository.list(tenantId, input);
      return paginate(items, total, input);
    } catch (error) {
      rethrow(error, 'Failed to list vehicles');
    }
  }

  async getVehicle(tenantId: string, vehicleId: string): Promise<VehicleEntity> {
    try {
      const vehicle = await this.vehicleRepository.findByIdWithRelations(tenantId, vehicleId);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to fetch vehicle');
    }
  }

  async updateVehicle(tenantId: string, actorId: string, vehicleId: string, input: UpdateVehicleInput): Promise<VehicleEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const vehicle = await this.vehicleRepository.update(tenantId, vehicleId, {
        ...input,
        capacityTons: input.capacityTons === undefined ? undefined : String(input.capacityTons),
        updatedBy: actorId,
      });
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to update vehicle');
    }
  }

  async deleteVehicle(tenantId: string, actorId: string, vehicleId: string): Promise<void> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);
      await this.vehicleRepository.softDelete(tenantId, vehicleId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete vehicle');
    }
  }

  async addDocument(tenantId: string, actorId: string, vehicleId: string, input: AddVehicleDocumentInput): Promise<VehicleDocumentEntity> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);

      const expiryDate = input.expiryDate ?? null;
      return await this.vehicleRepository.createDocument({
        tenantId,
        vehicleId,
        documentType: input.documentType,
        documentNumber: input.documentNumber ?? null,
        issueDate: input.issueDate ?? null,
        expiryDate,
        fileUrl: input.fileUrl ?? null,
        status: resolveDocumentStatus(expiryDate),
        createdBy: actorId,
      });
    } catch (error) {
      rethrow(error, 'Failed to add vehicle document');
    }
  }

  async listDocuments(tenantId: string, vehicleId: string): Promise<VehicleDocumentEntity[]> {
    try {
      await this.assertVehicleExists(tenantId, vehicleId);
      return await this.vehicleRepository.listDocuments(tenantId, vehicleId);
    } catch (error) {
      rethrow(error, 'Failed to list vehicle documents');
    }
  }

  async updateDocument(
    tenantId: string,
    actorId: string,
    vehicleId: string,
    documentId: string,
    input: UpdateVehicleDocumentInput,
  ): Promise<VehicleDocumentEntity> {
    try {
      const existing = await this.vehicleRepository.findDocumentById(tenantId, vehicleId, documentId);
      if (!existing) throw new NotFoundError(`Vehicle document ${documentId} not found`);

      // Recompute the status whenever the caller moves the expiry date.
      const expiryDate = input.expiryDate === undefined ? existing.expiryDate : input.expiryDate;

      const document = await this.vehicleRepository.updateDocument(tenantId, vehicleId, documentId, {
        ...input,
        expiryDate,
        status: resolveDocumentStatus(expiryDate),
        updatedBy: actorId,
      });
      if (!document) throw new NotFoundError(`Vehicle document ${documentId} not found`);
      return document;
    } catch (error) {
      rethrow(error, 'Failed to update vehicle document');
    }
  }

  async deleteDocument(tenantId: string, actorId: string, vehicleId: string, documentId: string): Promise<void> {
    try {
      const existing = await this.vehicleRepository.findDocumentById(tenantId, vehicleId, documentId);
      if (!existing) throw new NotFoundError(`Vehicle document ${documentId} not found`);
      await this.vehicleRepository.softDeleteDocument(tenantId, vehicleId, documentId, actorId);
    } catch (error) {
      rethrow(error, 'Failed to delete vehicle document');
    }
  }

  /** Shared by this service and the fleet-link service, which needs the vehicle to exist before linking. */
  async assertVehicleExists(tenantId: string, vehicleId: string): Promise<VehicleEntity> {
    try {
      const vehicle = await this.vehicleRepository.findById(tenantId, vehicleId);
      if (!vehicle) throw new NotFoundError(`Vehicle ${vehicleId} not found`);
      return vehicle;
    } catch (error) {
      rethrow(error, 'Failed to verify vehicle exists');
    }
  }
}
