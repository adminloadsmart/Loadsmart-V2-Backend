import { ServiceDueTrigger } from '../maintenance.types';
import { addMonths, daysBetween } from './dates';

export interface ServiceDueInput {
  odometerKm: number | null;
  lastServiceDate: string | null;
  lastServiceOdometerKm: number | null;
  intervalKm: number;
  intervalMonths: number;
  /** IST date the truck was added — the time clock's start when it has no service history. */
  onboardedOn?: string | null;
  /** IST calendar date. */
  today: string;
}

/** What the clocks were counted from: a recorded service, or (with no history) the day the truck
 *  was added. */
export type ServiceDueBaseline = 'last_service' | 'onboarded';

export interface ServiceDueResult {
  isDue: boolean;
  trigger: ServiceDueTrigger | null;
  dueAtKm: number | null;
  dueOn: string | null;
  /** Only set when the distance clock ran out — never a misleading 0. */
  overdueKm: number | null;
  /** Only set when the time clock ran out. */
  overdueDays: number | null;
  /** How far past policy, as a fraction of the interval (the larger of the two clocks) — the
   *  queue's sort key. Infinity for `no_record`, which sorts first. */
  overdueRatio: number;
  baseline: ServiceDueBaseline | null;
}

/**
 * Service is due on distance OR time, whichever runs out first — a truck that barely moves still
 * needs servicing on the calendar.
 *
 *   dueAtKm = lastServiceOdometerKm + intervalKm       → over when odometerKm ≥ dueAtKm
 *   dueOn   = lastServiceDate + intervalMonths          → over when today ≥ dueOn
 *
 * With no service record, the time clock starts the day the truck was added (Add Truck rarely
 * carries a service history, and calling every new truck overdue on day one buries the real
 * ones); the distance clock stays unread — there's no km to count from. Only with neither a
 * record nor an onboarding date is the truck reported as `no_record`, rather than left out.
 */
export function computeServiceDue(input: ServiceDueInput): ServiceDueResult {
  const { odometerKm, lastServiceOdometerKm, intervalKm, intervalMonths, onboardedOn, today } =
    input;

  const hasHistory = Boolean(input.lastServiceDate) || lastServiceOdometerKm !== null;
  if (!hasHistory && !onboardedOn) {
    return {
      isDue: true,
      trigger: 'no_record',
      dueAtKm: null,
      dueOn: null,
      overdueKm: null,
      overdueDays: null,
      overdueRatio: Number.POSITIVE_INFINITY,
      baseline: null,
    };
  }

  const lastServiceDate = hasHistory ? input.lastServiceDate : onboardedOn!;

  const dueAtKm = lastServiceOdometerKm === null ? null : lastServiceOdometerKm + intervalKm;
  const dueOn = lastServiceDate ? addMonths(lastServiceDate, intervalMonths) : null;

  const kmOver = dueAtKm !== null && odometerKm !== null ? odometerKm - dueAtKm : null;
  const daysOver = dueOn ? daysBetween(dueOn, today) : null;

  const distanceDue = kmOver !== null && kmOver >= 0;
  const timeDue = daysOver !== null && daysOver >= 0;

  const trigger: ServiceDueTrigger | null =
    distanceDue && timeDue ? 'both' : distanceDue ? 'distance' : timeDue ? 'time' : null;

  const kmRatio = distanceDue ? kmOver! / intervalKm : 0;
  const dayRatio = timeDue ? daysOver! / (intervalMonths * 30) : 0;

  return {
    isDue: trigger !== null,
    trigger,
    dueAtKm,
    dueOn,
    overdueKm: distanceDue ? kmOver : null,
    overdueDays: timeDue ? daysOver : null,
    overdueRatio: Math.max(kmRatio, dayRatio),
    baseline: hasHistory ? 'last_service' : 'onboarded',
  };
}
