import { MAINTENANCE_COSTS_VIEW } from '../../shared/constants/permissions';
import { VehicleBackInServiceContext } from './catalog/notification-catalog';
import { INDIA_TIME_ZONE, MS_PER_HOUR } from './notifications.constants';
import { BackInServiceResolverDeps } from './notifications.interface';

/**
 * LS_N_0055 "vehicle back in service" — context resolver. The maintenance module only queues the
 * closed job's id (see maintenance/gateways/notifications.gateway.local.ts); this reads the visit
 * at send time. Null (nothing sent) if the visit isn't closed.
 */
export function createBackInServiceResolver(deps: BackInServiceResolverDeps) {
  return async (
    tenantId: string,
    context: VehicleBackInServiceContext,
  ): Promise<VehicleBackInServiceContext | null> => {
    const job = await deps.scheduledAlertRepository.findClosedMaintenanceJob(
      tenantId,
      context.jobId,
    );
    if (!job?.closedAt) return null;
    const openRequisitionCount =
      await deps.scheduledAlertRepository.countOpenRequisitions(tenantId);
    const closedAt = new Date(job.closedAt);
    const downtimeHours = Math.max(
      0,
      (closedAt.getTime() - new Date(job.openedAt).getTime()) / MS_PER_HOUR,
    );
    const costViewers = await deps.listUsersWithPermission(tenantId, MAINTENANCE_COSTS_VIEW);
    return {
      ...context,
      vehicleId: job.vehicleId,
      vehicleNo: job.vehicle.registrationNumber,
      // Whole hours, or one decimal under 10 hours ("1.5", not "2").
      downtimeHours: String(
        downtimeHours >= 10 ? Math.round(downtimeHours) : Math.round(downtimeHours * 10) / 10,
      ),
      repairCost:
        job.totalCost == null
          ? null
          : `₹${Number(job.totalCost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      availableFrom: new Intl.DateTimeFormat('en-IN', {
        timeZone: INDIA_TIME_ZONE,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(closedAt),
      loadCount: openRequisitionCount,
      costViewerIds: costViewers.map((user) => user.id),
    };
  };
}
