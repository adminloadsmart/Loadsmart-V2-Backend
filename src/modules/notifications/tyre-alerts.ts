import { DataSource } from 'typeorm';
import { NotificationTriggers } from './notification-triggers';

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
export interface TyreQueueItem {
  tyreId: string;
  vehicle: { id: string; registrationNumber: string };
  position: string;
  nextStep: string;
}

export const TYRE_ACTION_LABELS: Record<string, string> = {
  retread: 'retread',
  new_tyre: 'replacement',
  scrap: 'scrapping',
};

interface TyreCostRow {
  id: string;
  tenant_id: string;
  km_run: number | null;
  cost: string | null;
}

const perKm = (value: number) => `₹${value.toFixed(2)}`;

export function createTyreAlerts(deps: {
  dataSource: DataSource;
  triggers: NotificationTriggers;
  listTyreQueue: (tenantId: string) => Promise<{ items: TyreQueueItem[] }>;
}) {
  const { dataSource, triggers } = deps;

  /** Every tyre of a tenant (fitted or not) with its km run and its share of its entry's cost. */
  const tyreCosts = (tenantId: string): Promise<TyreCostRow[]> =>
    dataSource.query(
      `SELECT t.id, t.tenant_id,
              COALESCE(t.removed_odometer_km, u.odometer_km) - t.fitted_odometer_km AS km_run,
              j.total_cost / NULLIF((SELECT count(*) FROM maintenance.tyres s
                                      WHERE s.maintenance_job_id = t.maintenance_job_id), 0) AS cost
         FROM maintenance.tyres t
         LEFT JOIN masters.vehicle_service_usage u ON u.vehicle_id = t.vehicle_id AND u.deleted_at IS NULL
         LEFT JOIN maintenance.maintenance_jobs j ON j.id = t.maintenance_job_id
        WHERE t.tenant_id = $1`,
      [tenantId],
    );

  const reportedTyreIds = async (tenantId: string, vehicleId: string): Promise<Set<string>> => {
    const rows: { tyre_ids: string }[] = await dataSource.query(
      `SELECT DISTINCT metadata->>'tyre_ids' AS tyre_ids FROM notifications.notifications
        WHERE tenant_id = $1 AND type = 'vehicle.tyre_attention' AND metadata->>'vehicle_id' = $2`,
      [tenantId, vehicleId],
    );
    return new Set(rows.flatMap((row) => (row.tyre_ids ?? '').split(',').filter(Boolean)));
  };

  return {
    async runDaily(today: string) {
      const tenants: { tenant_id: string }[] = await dataSource.query(
        `SELECT DISTINCT tenant_id FROM maintenance.tyres WHERE status = 'fitted'`,
      );
      let vehicles = 0;
      for (const { tenant_id: tenantId } of tenants) {
        const { items } = await deps.listTyreQueue(tenantId);
        if (items.length === 0) continue;
        const costs = new Map((await tyreCosts(tenantId)).map((row) => [row.id, row]));
        const costed = [...costs.values()].filter(
          (row) => row.cost != null && (row.km_run ?? 0) > 0,
        );
        const fleetKm = costed.reduce((sum, row) => sum + Number(row.km_run), 0);
        const fleetCost = costed.reduce((sum, row) => sum + Number(row.cost), 0);
        const fleetCpk = fleetKm > 0 ? perKm(fleetCost / fleetKm) : null;

        const byVehicle = new Map<string, TyreQueueItem[]>();
        for (const item of items) {
          byVehicle.set(item.vehicle.id, [...(byVehicle.get(item.vehicle.id) ?? []), item]);
        }
        for (const [vehicleId, tyres] of byVehicle) {
          const reported = await reportedTyreIds(tenantId, vehicleId);
          if (tyres.every((tyre) => reported.has(tyre.tyreId))) continue;
          await triggers.enqueue('vehicle.tyre_attention', tenantId, {
            vehicleId,
            vehicleNo: tyres[0].vehicle.registrationNumber,
            tyres: tyres
              .sort((a, b) => a.position.localeCompare(b.position))
              .map((tyre) => {
                const cost = costs.get(tyre.tyreId);
                const km = Math.max(0, Number(cost?.km_run ?? 0));
                return {
                  tyreId: tyre.tyreId,
                  position: tyre.position,
                  km,
                  action: TYRE_ACTION_LABELS[tyre.nextStep] ?? tyre.nextStep,
                  cpk: cost?.cost != null && km > 0 ? perKm(Number(cost.cost) / km) : null,
                };
              }),
            fleetCpk,
            runDate: today,
          });
          vehicles += 1;
        }
      }
      return { tyreAttentionVehicles: vehicles };
    },

    /** Relevance check — a re-run of the same day's check never sends a vehicle twice. */
    notAlreadySentToday: async (
      tenantId: string,
      context: { vehicleId: string; runDate: string },
    ) => {
      const [row] = await dataSource.query(
        `SELECT 1 FROM notifications.notifications WHERE tenant_id = $1 AND type = 'vehicle.tyre_attention'
            AND metadata->>'vehicle_id' = $2 AND metadata->>'run_date' = $3 LIMIT 1`,
        [tenantId, context.vehicleId, context.runDate],
      );
      return !row;
    },
  };
}
