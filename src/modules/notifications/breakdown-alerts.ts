import { DataSource } from 'typeorm';
import { NotificationTriggers } from './notification-triggers';
import { BreakdownReportedContext } from './catalog/notification-catalog';

/**
 * LS_N_0054 "driver marked a breakdown". LoadService.reportIssue calls the notifier after a
 * driver's 'breakdown' issue report is saved — it only queues the issue id (never throws, never
 * slows the driver app); the trigger worker's resolver then reads everything the message needs.
 */
export type BreakdownReportedNotifier = (event: {
  tenantId: string;
  loadId: string;
  issueId: string;
}) => Promise<void>;

export function createBreakdownNotifier(triggers: NotificationTriggers): BreakdownReportedNotifier {
  return async ({ tenantId, loadId, issueId }) => {
    try {
      await triggers.enqueue('load.breakdown_reported', tenantId, { issueId, loadId });
    } catch (error) {
      console.warn(`Failed to queue breakdown notification for issue ${issueId}`, error);
    }
  };
}

/** "14:35" in India time. */
function indiaTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** Context resolver: the report plus its trip. Null (nothing sent) if the report is gone. */
export function createBreakdownResolver(dataSource: DataSource) {
  return async (
    tenantId: string,
    context: BreakdownReportedContext,
  ): Promise<BreakdownReportedContext | null> => {
    const [row] = await dataSource.query(
      `SELECT i.details, i.location_label, i.latitude, i.longitude,
              COALESCE(i.location_captured_at, i.created_at) AS reported_at,
              l.code AS load_code, COALESCE(l.vehicle_number, v.registration_number) AS vehicle_no,
              COALESCE(d.full_name, l.driver_name) AS driver_name, d.phone_number AS driver_phone,
              c.name AS consignee, COALESCE(dp.location, dp.city) AS destination
         FROM loads.load_issue_reports i
         JOIN loads.loads l ON l.id = i.load_id
         JOIN loads.requisitions r ON r.id = l.requisition_id
         LEFT JOIN masters.vehicles v ON v.id = l.vehicle_id
         LEFT JOIN masters.drivers d ON d.id = l.driver_id
         LEFT JOIN customers.customers c ON c.id = r.customer_id
         LEFT JOIN customers.customer_delivery_points dp ON dp.id = r.customer_delivery_point_id
        WHERE i.id = $1 AND i.tenant_id = $2`,
      [context.issueId, tenantId],
    );
    if (!row) return null;
    const coordinates =
      row.latitude != null && row.longitude != null ? `${row.latitude}, ${row.longitude}` : null;
    const note = typeof row.details === 'string' ? row.details.trim() : '';
    return {
      ...context,
      vehicleNo: row.vehicle_no ?? undefined,
      driverName: row.driver_name ?? 'The driver',
      driverPhone: row.driver_phone ?? 'not available',
      breakdownType: note || 'a breakdown',
      location: row.location_label ?? coordinates ?? 'an unknown location',
      reportTime: indiaTime(new Date(row.reported_at)),
      destination: row.destination ?? 'the destination',
      loadCode: row.load_code,
      consignee: row.consignee ?? 'the consignee',
    };
  };
}
