import { TyreAttentionContext } from './catalog/notification-catalog';
import { TYRE_ACTION_LABELS } from './notifications.constants';
import { TyreAlertsDeps, TyreQueueItem } from './notifications.interface';

/**
 * LS_N_0058 "tyre needs attention" — part of the daily 9:00 IST check. "Needs attention" is
 * exactly the maintenance tyres queue (TyreService.listQueue: at the legal floor, under 30%
 * usable tread, or reaching the floor within 30 days at its wear rate), so the alert and the
 * screen always agree. One message per vehicle, rolling up every tyre on it in the queue, sent
 * when at least one of them hasn't been reported yet — a tyre is reported once, until it is
 * replaced (a new tyre is a new id).
 *
 * Cost per km: tyre cost = its Record Tyre Maintenance entry's total ÷ the tyres that entry
 * fitted; ÷ km run (removal odometer, else the vehicle's current one, minus the fitted odometer).
 * The fleet average is the organisation's costed tyres' cost ÷ their km. Tyres fitted with the
 * truck at onboarding carry no cost, so their cost sentence is dropped.
 */
const TYRE_ATTENTION_TYPE = 'vehicle.tyre_attention';

const perKm = (value: number) => `₹${value.toFixed(2)}`;

export function createTyreAlerts(deps: TyreAlertsDeps) {
  const { scheduledAlertRepository, triggers } = deps;

  const reportedTyreIds = async (tenantId: string, vehicleId: string): Promise<Set<string>> => {
    const sentMetadata = await scheduledAlertRepository.listSentNotificationMetadata(
      tenantId,
      TYRE_ATTENTION_TYPE,
      { vehicle_id: vehicleId },
    );
    return new Set(
      sentMetadata.flatMap((metadata) =>
        String(metadata.tyre_ids ?? '')
          .split(',')
          .filter(Boolean),
      ),
    );
  };

  return {
    async runDaily(today: string) {
      let vehicleCount = 0;
      for (const tenantId of await scheduledAlertRepository.listTenantsWithFittedTyres()) {
        const { items } = await deps.listTyreQueue(tenantId);
        if (items.length === 0) continue;
        const costByTyreId = new Map(
          (await scheduledAlertRepository.findTyreCosts(tenantId)).map((tyreCost) => [
            tyreCost.tyreId,
            tyreCost,
          ]),
        );
        const costedTyres = [...costByTyreId.values()].filter(
          (tyreCost) => tyreCost.cost != null && (tyreCost.kmRun ?? 0) > 0,
        );
        const fleetKm = costedTyres.reduce((sum, tyreCost) => sum + Number(tyreCost.kmRun), 0);
        const fleetCost = costedTyres.reduce((sum, tyreCost) => sum + Number(tyreCost.cost), 0);
        const fleetCpk = fleetKm > 0 ? perKm(fleetCost / fleetKm) : null;

        const tyresByVehicle = new Map<string, TyreQueueItem[]>();
        for (const item of items) {
          tyresByVehicle.set(item.vehicle.id, [
            ...(tyresByVehicle.get(item.vehicle.id) ?? []),
            item,
          ]);
        }
        for (const [vehicleId, tyres] of tyresByVehicle) {
          const reported = await reportedTyreIds(tenantId, vehicleId);
          if (tyres.every((tyre) => reported.has(tyre.tyreId))) continue;
          await triggers.enqueue(TYRE_ATTENTION_TYPE, tenantId, {
            vehicleId,
            vehicleNo: tyres[0].vehicle.registrationNumber,
            tyres: tyres
              .sort((first, second) => first.position.localeCompare(second.position))
              .map((tyre) => {
                const tyreCost = costByTyreId.get(tyre.tyreId);
                const km = Math.max(0, Number(tyreCost?.kmRun ?? 0));
                return {
                  tyreId: tyre.tyreId,
                  position: tyre.position,
                  km,
                  action: TYRE_ACTION_LABELS[tyre.nextStep] ?? tyre.nextStep,
                  cpk: tyreCost?.cost != null && km > 0 ? perKm(tyreCost.cost / km) : null,
                  treadMm: tyre.currentTreadMm ?? null,
                };
              }),
            fleetCpk,
            runDate: today,
          });
          vehicleCount += 1;
        }
      }
      return { tyreAttentionVehicles: vehicleCount };
    },

    /** Relevance check — a re-run of the same day's check never sends a vehicle twice. */
    notAlreadySentToday: async (tenantId: string, context: TyreAttentionContext) =>
      !(await scheduledAlertRepository.hasSentNotification(tenantId, TYRE_ATTENTION_TYPE, {
        vehicle_id: context.vehicleId,
        run_date: context.runDate,
      })),
  };
}
