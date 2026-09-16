import { Job, Worker } from 'bullmq';
import { getQueueConnection } from '../../../../jobs/queue-connection';
import { NotifyByType } from '../../../notifications/notify-by-type';
import { VEHICLE_NOTIFICATION_CATALOG } from '../../../notifications/catalog/vehicle-notifications.catalog';
import { VehicleRepository } from '../vehicle.repository';
import { DOCUMENT_TYPE_LABELS } from '../vehicle.constants';
import { VehicleDocumentTypeWithExpiry } from '../vehicle.type';

interface ComplianceAlertJobPayload {
  documentId: string;
  vehicleId: string;
  tenantId: string;
}

/**
 * BullMQ Worker on the `vehicle-compliance-alerts` queue — consumes the two one-time delayed jobs
 * VehicleService.scheduleComplianceAlerts schedules per document (job name 'expiry-soon' or
 * 'expired'). Re-fetches the document fresh at fire time rather than trusting the payload's
 * snapshot: by the time a 15-day- or expiry-delayed job actually runs, the document may have been
 * renewed, deleted, or the vehicle removed — in any of those cases this is a silent no-op rather
 * than sending a stale alert (rescheduling on save already cancels/replaces the job for the common
 * "renewed" case; this is the safety net for the rest).
 */
export function createVehicleComplianceAlertsWorker(
  vehicleRepository: VehicleRepository,
  notifyByType: NotifyByType,
): Worker {
  return new Worker<ComplianceAlertJobPayload>(
    'vehicle-compliance-alerts',
    async (job: Job<ComplianceAlertJobPayload>) => {
      const { documentId, vehicleId, tenantId } = job.data;

      const [document, vehicle] = await Promise.all([
        vehicleRepository.findDocumentById(tenantId, vehicleId, documentId),
        vehicleRepository.findById(tenantId, vehicleId),
      ]);
      if (!document || !vehicle || !document.expiryDate) return;

      const complianceType =
        DOCUMENT_TYPE_LABELS[document.documentType as VehicleDocumentTypeWithExpiry] ??
        document.documentType;
      const type =
        job.name === 'expiry-soon'
          ? 'vehicle.compliance_expiring_soon'
          : 'vehicle.compliance_expired';

      await notifyByType(VEHICLE_NOTIFICATION_CATALOG, type, tenantId, {
        complianceType,
        vehicleNo: vehicle.registrationNumber,
        expiryDate: document.expiryDate,
      });
    },
    { connection: getQueueConnection(), concurrency: 5 },
  );
}
