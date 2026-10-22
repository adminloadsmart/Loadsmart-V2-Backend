import type { LoadIssueCategory } from '../loads/utils/loads.types';
import { LoadIssueReportEntity } from '../loads/entities/load-issue-report.entity';
import { NotificationTriggers } from './notification-triggers';
import {
  BreakdownReportedContext,
  DriverProblemReportedContext,
} from './catalog/notification-catalog';
import { DRIVER_PROBLEM_ALERT_CATEGORIES, INDIA_TIME_ZONE } from './notifications.constants';
import { LoadAlertRepository } from './load-alert.repository';
import { LoadAlertSnapshot } from './notifications.interface';

/**
 * A driver's "Report an issue" from the driver app. LoadService.reportIssue calls the notifier
 * after the report is saved — it only queues the issue id (never throws, never slows the driver
 * app); the trigger worker's resolvers below then read everything the message needs:
 * - 'breakdown' → LS_N_0054 "driver marked a breakdown";
 * - DRIVER_PROBLEM_ALERT_CATEGORIES (accident, road block, police check, strike, weather,
 *   other) → LS_N_0037 "driver reported a problem";
 * - anything else (traffic jam, rest stop) is routine — on the load's timeline only.
 */
export type IssueReportedNotifier = (event: {
  tenantId: string;
  loadId: string;
  issueId: string;
  category: LoadIssueCategory;
}) => Promise<void>;

export function createIssueReportedNotifier(triggers: NotificationTriggers): IssueReportedNotifier {
  return async ({ tenantId, loadId, issueId, category }) => {
    try {
      if (category === 'breakdown') {
        await triggers.enqueue('load.breakdown_reported', tenantId, { issueId, loadId });
      } else if (DRIVER_PROBLEM_ALERT_CATEGORIES.includes(category)) {
        await triggers.enqueue('load.driver_problem_reported', tenantId, { issueId, loadId });
      }
    } catch (error) {
      console.warn(`Failed to queue the issue-report notification for issue ${issueId}`, error);
    }
  };
}

/** "14:35" in India time. */
function indiaTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** The report plus the load it's on. Undefined if either is gone. */
async function findIssueWithLoad(
  loadAlertRepository: LoadAlertRepository,
  tenantId: string,
  issueId: string,
): Promise<{ issue: LoadIssueReportEntity; load: LoadAlertSnapshot } | undefined> {
  const issue = await loadAlertRepository.findIssueReport(tenantId, issueId);
  if (!issue) return undefined;
  const load = await loadAlertRepository.findSnapshot(tenantId, issue.loadId);
  return load ? { issue, load } : undefined;
}

const locationOf = (issue: LoadIssueReportEntity): string | null =>
  issue.locationLabel ||
  (issue.latitude != null && issue.longitude != null
    ? `${issue.latitude}, ${issue.longitude}`
    : null);

const reportedAtOf = (issue: LoadIssueReportEntity): Date =>
  issue.locationCapturedAt ?? issue.createdAt;

const driverNoteOf = (issue: LoadIssueReportEntity): string => issue.details?.trim() ?? '';

/** LS_N_0054 context resolver. Null (nothing sent) if the report is gone. */
export function createBreakdownResolver(loadAlertRepository: LoadAlertRepository) {
  return async (
    tenantId: string,
    context: BreakdownReportedContext,
  ): Promise<BreakdownReportedContext | null> => {
    const found = await findIssueWithLoad(loadAlertRepository, tenantId, context.issueId);
    if (!found) return null;
    const { issue, load } = found;
    return {
      ...context,
      vehicleNo: load.vehicleNumber ?? undefined,
      driverName: load.driverName ?? 'The driver',
      driverPhone: load.driverPhone ?? 'not available',
      breakdownType: driverNoteOf(issue) || 'a breakdown',
      location: locationOf(issue) ?? 'an unknown location',
      reportTime: indiaTime(reportedAtOf(issue)),
      destination: load.destinationCity ?? 'the destination',
      loadCode: load.code,
      consignee: load.consigneeName ?? 'the consignee',
    };
  };
}

/** LS_N_0037 context resolver. Null (nothing sent) if the report is gone. */
export function createDriverProblemResolver(loadAlertRepository: LoadAlertRepository) {
  return async (
    tenantId: string,
    context: DriverProblemReportedContext,
  ): Promise<DriverProblemReportedContext | null> => {
    const found = await findIssueWithLoad(loadAlertRepository, tenantId, context.issueId);
    if (!found) return null;
    const { issue, load } = found;
    return {
      ...context,
      loadCode: load.code,
      vehicleNo: load.vehicleNumber,
      consignee: load.consigneeName,
      category: issue.category,
      driverName: load.driverName,
      driverPhone: load.driverPhone,
      location: locationOf(issue),
      reportedAt: reportedAtOf(issue).toISOString(),
      driverNote: driverNoteOf(issue) || null,
      etaImpactMinutes: issue.etaImpactMinutes,
    };
  };
}
