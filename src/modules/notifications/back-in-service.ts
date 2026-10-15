import { DataSource } from 'typeorm';
import { MAINTENANCE_COSTS_VIEW } from '../../shared/constants/permissions';
import { VehicleBackInServiceContext } from './catalog/notification-catalog';

/**
 * LS_N_0055 "vehicle back in service" — context resolver. The maintenance module only queues the
 * closed job's id (see maintenance/gateways/notifications.gateway.local.ts); this reads the visit
 * at send time. Null (nothing sent) if the visit isn't closed.
 */
export function createBackInServiceResolver(deps: {
  dataSource: DataSource;
  listUsersWithPermission: (tenantId: string, permission: string) => Promise<{ id: string }[]>;
}) {
  return async (
    tenantId: string,
    context: VehicleBackInServiceContext,
  ): Promise<VehicleBackInServiceContext | null> => {
    const [job] = await deps.dataSource.query(
      `SELECT j.vehicle_id, j.opened_at, j.closed_at, j.total_cost, v.registration_number
         FROM maintenance.maintenance_jobs j
         JOIN masters.vehicles v ON v.id = j.vehicle_id
        WHERE j.id = $1 AND j.tenant_id = $2 AND j.status = 'closed'`,
      [context.jobId, tenantId],
    );
    if (!job) return null;
    const [{ count }] = await deps.dataSource.query(
      `SELECT count(*)::int AS count FROM loads.requisitions WHERE tenant_id = $1 AND status = 'open'`,
      [tenantId],
    );
    const closedAt = new Date(job.closed_at);
    const hours = Math.max(0, (closedAt.getTime() - new Date(job.opened_at).getTime()) / 3_600_000);
    const costViewers = await deps.listUsersWithPermission(tenantId, MAINTENANCE_COSTS_VIEW);
    return {
      ...context,
      vehicleId: job.vehicle_id,
      vehicleNo: job.registration_number,
      // Whole hours, or one decimal under 10 hours ("1.5", not "2").
      downtimeHours: String(hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10),
      repairCost:
        job.total_cost == null
          ? null
          : `₹${Number(job.total_cost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      availableFrom: new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(closedAt),
      loadCount: count,
      costViewerIds: costViewers.map((user) => user.id),
    };
  };
}
