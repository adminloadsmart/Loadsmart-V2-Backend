import { addDays, daysBetween } from '../maintenance/calculations/dates';
import {
  DEFAULT_AVG_DAILY_KM,
  DEFAULT_SERVICE_INTERVAL_KM,
} from '../maintenance/maintenance.constants';
import { MAINTENANCE_MANAGE } from '../../shared/constants/permissions';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { ServiceDueSoonContext, ServiceOverdueContext } from './catalog/notification-catalog';
import { ServiceAlertsDeps, ServiceDueVehicle } from './notifications.interface';

/**
 * LS_N_0056 "service due soon" / LS_N_0057 "service overdue" — run inside the daily 9:00 IST
 * check (see vehicle-document-alerts.ts's schedule worker). Distance clock only, as the sheet
 * asks: due at last-service odometer + the vehicle's interval (DEFAULT_SERVICE_INTERVAL_KM when
 * it has no policy of its own), the same reading maintenance's service-due queue uses. There is
 * no charge-cycle data, so EVs follow the same odometer rule.
 *
 * Skipped: vehicles with no service record (nothing to measure from) and trucks already in the
 * workshop (someone is on it). A logged service moves the last-service odometer, which starts a
 * new cycle — keyed by its due-at km — so both alerts reset on their own.
 */
const DUE_SOON_SHARE = 0.1; // first alert with 10% of the interval left…
const DUE_SOON_HALF_SHARE = 0.05; // …and again at half that distance
const OVERDUE_REPEAT_DAYS = 7;
const OVERDUE_ESCALATE_DAYS = 14;
const SERVICE_TYPE = 'preventive';
const DUE_SOON_TYPE = 'vehicle.service_due_soon';
const OVERDUE_TYPE = 'vehicle.service_overdue';

const rupees = (value: number) =>
  `₹${Math.round(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function createServiceAlerts(deps: ServiceAlertsDeps) {
  const { scheduledAlertRepository, triggers } = deps;

  /** km a day since the last service; DEFAULT_AVG_DAILY_KM without a dated service or distance —
   *  the same fallback maintenance's tyre forecast uses. */
  const dailyAverageKm = (vehicle: ServiceDueVehicle, today: string): number => {
    if (!vehicle.lastServiceDate) return DEFAULT_AVG_DAILY_KM;
    const days = daysBetween(vehicle.lastServiceDate, today);
    const km = vehicle.odometerKm - vehicle.lastServiceOdometerKm;
    return days > 0 && km > 0 ? km / days : DEFAULT_AVG_DAILY_KM;
  };

  const averageCosts = async (tenantId: string, today: string) => {
    const averages = await scheduledAlertRepository.averageMaintenanceCosts(tenantId, today);
    return {
      serviceCost: averages.service != null ? rupees(averages.service) : null,
      breakdownCost: averages.breakdown != null ? rupees(averages.breakdown) : null,
    };
  };

  /** Run dates of this service cycle's overdue alerts, oldest first. */
  const sentRunDates = async (tenantId: string, vehicleId: string, dueAtKm: number) => {
    const sentMetadata = await scheduledAlertRepository.listSentNotificationMetadata(
      tenantId,
      OVERDUE_TYPE,
      { vehicle_id: vehicleId, service_due_km: String(dueAtKm) },
    );
    return [...new Set(sentMetadata.map((metadata) => String(metadata.run_date)))].sort();
  };

  const dueSoonStagesSent = async (tenantId: string, vehicleId: string, dueAtKm: number) => {
    const sentMetadata = await scheduledAlertRepository.listSentNotificationMetadata(
      tenantId,
      DUE_SOON_TYPE,
      { vehicle_id: vehicleId, service_due_km: String(dueAtKm) },
    );
    return sentMetadata.map((metadata) => String(metadata.stage));
  };

  /** Anyone other than an org admin holding maintenance.manage (org admins hold it by role). */
  const hasMaintenanceHolders = async (tenantId: string): Promise<boolean> =>
    (await deps.listUsersWithPermission(tenantId, MAINTENANCE_MANAGE)).some(
      (user) => user.role.name !== ORG_ADMIN_ROLE,
    );

  return {
    async runDaily(today: string) {
      let dueSoonCount = 0;
      let overdueCount = 0;
      for (const vehicle of await scheduledAlertRepository.findServiceDueVehicles()) {
        const intervalKm = vehicle.intervalKm ?? DEFAULT_SERVICE_INTERVAL_KM;
        const dueAtKm = vehicle.lastServiceOdometerKm + intervalKm;
        const kmLeft = dueAtKm - vehicle.odometerKm;

        if (kmLeft > 0) {
          // LS_N_0056 — once inside 10% of the interval, again inside 5%. Jumping straight into
          // the 5% band (a big odometer update) sends just that one.
          const stage =
            kmLeft <= intervalKm * DUE_SOON_HALF_SHARE
              ? 'half'
              : kmLeft <= intervalKm * DUE_SOON_SHARE
                ? 'threshold'
                : null;
          if (!stage) continue;
          const sentStages = await dueSoonStagesSent(vehicle.tenantId, vehicle.vehicleId, dueAtKm);
          if (
            sentStages.includes(stage) ||
            (stage === 'threshold' && sentStages.includes('half'))
          ) {
            continue;
          }
          const dailyAvgKm = dailyAverageKm(vehicle, today);
          const daysLeft = Math.max(1, Math.ceil(kmLeft / dailyAvgKm));
          await triggers.enqueue(DUE_SOON_TYPE, vehicle.tenantId, {
            vehicleId: vehicle.vehicleId,
            vehicleNo: vehicle.vehicleNo,
            kmRemaining: kmLeft,
            serviceType: SERVICE_TYPE,
            serviceDueKm: dueAtKm,
            dailyAvgKm: Math.round(dailyAvgKm),
            daysRemaining: daysLeft,
            plannedTripCount: await scheduledAlertRepository.countPlannedVehicleTrips(
              vehicle.tenantId,
              vehicle.vehicleId,
              { fromDate: today, toDate: addDays(today, daysLeft) },
            ),
            stage,
            runDate: today,
          });
          dueSoonCount += 1;
          continue;
        }

        // LS_N_0057 — past the due km: weekly from the first alert of this service cycle; the
        // org admin joins once it has been overdue 2 weeks (or straight away if nobody holds
        // maintenance.manage, so it never goes unheard).
        if (kmLeft === 0) continue; // at the limit, not yet past it
        const runDates = await sentRunDates(vehicle.tenantId, vehicle.vehicleId, dueAtKm);
        const lastRunDate = runDates[runDates.length - 1];
        if (lastRunDate && daysBetween(lastRunDate, today) < OVERDUE_REPEAT_DAYS) continue;
        const firstRunDate = runDates[0] ?? today;
        await triggers.enqueue(OVERDUE_TYPE, vehicle.tenantId, {
          vehicleId: vehicle.vehicleId,
          vehicleNo: vehicle.vehicleNo,
          kmOverdue: -kmLeft,
          serviceType: SERVICE_TYPE,
          serviceDueKm: dueAtKm,
          currentOdometer: vehicle.odometerKm,
          ...(await averageCosts(vehicle.tenantId, today)),
          escalated:
            daysBetween(firstRunDate, today) >= OVERDUE_ESCALATE_DAYS ||
            !(await hasMaintenanceHolders(vehicle.tenantId)),
          runDate: today,
        });
        overdueCount += 1;
      }
      return { serviceDueSoon: dueSoonCount, serviceOverdue: overdueCount };
    },

    /** Relevance checks — a re-run of the same day's check never sends a stage/run twice. */
    dueSoonNotAlreadySent: async (tenantId: string, context: ServiceDueSoonContext) =>
      !(await dueSoonStagesSent(tenantId, context.vehicleId, context.serviceDueKm)).includes(
        context.stage,
      ),
    overdueNotAlreadySentToday: async (tenantId: string, context: ServiceOverdueContext) =>
      !(await sentRunDates(tenantId, context.vehicleId, context.serviceDueKm)).includes(
        context.runDate,
      ),
  };
}
