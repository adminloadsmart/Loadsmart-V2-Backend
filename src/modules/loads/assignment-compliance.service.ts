import { DataSource, Repository } from 'typeorm';
import { ConflictError } from '../../shared/errors';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { resolveDocumentStatus } from '../masters/vehicle/vehicle.service';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../masters/vehicle/vehicle.type';
import { DOCUMENT_TYPE_LABELS } from '../masters/vehicle/vehicle.constants';
import { DriverTenantRelationEntity } from '../driver/entities/driver-tenant-relation.entity';
import type { AssignmentBlockedEvent } from '../notifications/notifications.interface';
import {
  AssignmentCompliance,
  AssignmentComplianceFailure,
  AssignmentTarget,
} from './utils/load.interface';
import { DRIVING_LICENCE_DOC_LABEL } from './utils/loads.types';

const DATED_DOCUMENT_TYPES: readonly string[] = VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY;

/** Registration numbers compared without spaces/dashes and case-blind. */
const plateKey = (vehicleNumber: string) =>
  vehicleNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * Assignment-time compliance (LS_N_0017): a vehicle with an expired RC, insurance, permit, PUC,
 * fitness or road tax, or a driver with an expired licence, cannot be assigned to a load. Uses the
 * same expiry rules the masters screens show — vehicle papers via resolveDocumentStatus, the
 * licence expired from the day after its expiry date (UTC, like the driver roster's
 * 'licence_expired' filter). A typed-in market vehicle or driver that isn't in the masters can't
 * be checked and is let through (`vehicleChecked`/`driverChecked` say so). Read-only.
 */
export class AssignmentComplianceService {
  private readonly vehicles: Repository<VehicleEntity>;
  private readonly driverRelations: Repository<DriverTenantRelationEntity>;

  constructor(dataSource: DataSource) {
    this.vehicles = dataSource.getRepository(VehicleEntity);
    this.driverRelations = dataSource.getRepository(DriverTenantRelationEntity);
  }

  async check(tenantId: string, target: AssignmentTarget): Promise<AssignmentCompliance> {
    const vehicle = await this.findVehicle(tenantId, target);
    const relation = await this.findDriverRelation(tenantId, target);

    let failure: AssignmentComplianceFailure | null = null;
    const expiredDocument = (vehicle?.documents ?? [])
      .filter(
        (document) =>
          !document.deletedAt &&
          document.expiryDate &&
          DATED_DOCUMENT_TYPES.includes(document.documentType) &&
          resolveDocumentStatus(document.expiryDate) === 'expired',
      )
      .sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))[0];
    if (expiredDocument) {
      failure = {
        subject: 'vehicle',
        docType:
          DOCUMENT_TYPE_LABELS[expiredDocument.documentType as keyof typeof DOCUMENT_TYPE_LABELS] ??
          expiredDocument.documentType,
        expiryDate: expiredDocument.expiryDate!,
      };
    }

    const licenceExpiry = relation?.driver.licenseExpiry ?? null;
    const today = new Date().toISOString().slice(0, 10);
    if (!failure && licenceExpiry && licenceExpiry < today) {
      failure = {
        subject: 'driver',
        docType: DRIVING_LICENCE_DOC_LABEL,
        expiryDate: licenceExpiry,
      };
    }

    return {
      vehicleId: vehicle?.id ?? null,
      driverId: relation?.driverId ?? null,
      driverName: relation?.driver.fullName ?? null,
      vehicleChecked: Boolean(vehicle),
      driverChecked: Boolean(relation),
      failure,
    };
  }

  private async findVehicle(
    tenantId: string,
    target: AssignmentTarget,
  ): Promise<VehicleEntity | null> {
    if (!target.vehicleId && !target.vehicleNumber?.trim()) return null;
    const query = this.vehicles
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.documents', 'document')
      .where('vehicle.tenant_id = :tenantId', { tenantId })
      .andWhere('vehicle.deleted_at IS NULL');
    if (target.vehicleId) {
      query.andWhere('vehicle.id = :vehicleId', { vehicleId: target.vehicleId });
    } else {
      query.andWhere(
        "upper(regexp_replace(vehicle.registration_number, '[^A-Za-z0-9]', '', 'g')) = :plate",
        { plate: plateKey(target.vehicleNumber!) },
      );
    }
    return query.getOne();
  }

  /** Drivers are a global profile; this organisation's membership is driver_tenant_relations. A
   *  typed-in phone number is matched on its last 10 digits. */
  private async findDriverRelation(
    tenantId: string,
    target: AssignmentTarget,
  ): Promise<DriverTenantRelationEntity | null> {
    const phoneDigits = target.driverPhone?.replace(/\D+/g, '').slice(-10) || null;
    if (!target.driverId && !phoneDigits) return null;
    const query = this.driverRelations
      .createQueryBuilder('relation')
      .innerJoinAndSelect('relation.driver', 'driver')
      .where('relation.tenant_id = :tenantId', { tenantId })
      .andWhere('relation.deleted_at IS NULL')
      .andWhere("relation.status <> 'rejected'")
      .andWhere('driver.deleted_at IS NULL');
    if (target.driverId) {
      query.andWhere('driver.id = :driverId', { driverId: target.driverId });
    } else {
      query.andWhere("right(regexp_replace(driver.phone_number, '\\D', '', 'g'), 10) = :phone", {
        phone: phoneDigits,
      });
    }
    return query.getOne();
  }
}

/** The 409 an assignment blocked by `failure` returns — the screen shows the message as-is. */
export function assignmentBlockedError(
  vehicleNumber: string,
  failure: AssignmentComplianceFailure,
  driverName: string | null,
): ConflictError {
  const message =
    failure.subject === 'vehicle'
      ? `${vehicleNumber} can't be assigned: its ${failure.docType} expired on ${failure.expiryDate}. Renew it or use another vehicle.`
      : `${driverName ?? 'This driver'} can't be assigned: their driving licence expired on ${failure.expiryDate}. Renew it or choose another driver.`;
  return new ConflictError(message, {
    reason: 'compliance_expired',
    subject: failure.subject,
    docType: failure.docType,
    expiryDate: failure.expiryDate,
  });
}

/** LS_N_0017's event for a refused assignment — `where` says which load / requisition / post it
 *  was for (see AssignmentBlockedEvent). */
export function assignmentBlockedEvent(
  tenantId: string,
  vehicleNumber: string,
  compliance: AssignmentCompliance,
  failure: AssignmentComplianceFailure,
  where: Pick<
    AssignmentBlockedEvent,
    'loadId' | 'requisitionId' | 'transporterName' | 'originCity' | 'destinationCity' | 'pickupAt'
  >,
  driverName: string | null = compliance.driverName,
): AssignmentBlockedEvent {
  return {
    kind: 'assignment_blocked',
    tenantId,
    at: new Date(),
    vehicleNumber,
    vehicleId: compliance.vehicleId,
    driverId: compliance.driverId,
    driverName,
    subject: failure.subject,
    docType: failure.docType,
    expiryDate: failure.expiryDate,
    ...where,
  };
}
