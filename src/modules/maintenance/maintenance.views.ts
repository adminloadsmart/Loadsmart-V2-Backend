import { MaintenanceJobEntity, ReplacedPart } from './entities/maintenance-job.entity';
import { VehicleEntity } from '../masters/vehicle/entities/vehicle.entity';
import { dailyFixedCost, elapsedDays, jobDays, money } from './calculations/downtime';
import { elapsedDaysHours } from './calculations/dates';
import { ServiceDueResult } from './calculations/service-due';
import { JobCostInput } from './maintenance.interface';

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/** The truck column on every queue — registration, make/model underneath, and the Class. */
export function toVehicleSummary(vehicle: VehicleEntity) {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    makeModel: vehicle.makeModel ?? null,
    truckTypeName: vehicle.truckType?.name ?? null,
    status: vehicle.status,
  };
}

/** The "What it needs" column on a service-due row — which clock ran out and by how much. */
export function serviceWhatItNeeds(due: ServiceDueResult) {
  const pastInterval = (amount: number, unit: string) =>
    amount > 0 ? `${amount.toLocaleString('en-IN')} ${unit} past the interval` : 'due now';

  let detail: string;
  if (due.trigger === 'no_record') detail = 'no service record';
  else if (due.overdueKm) detail = pastInterval(due.overdueKm, 'km');
  else detail = pastInterval(due.overdueDays ?? 0, 'days');

  return { need: 'service' as const, detail };
}

/** The "What it needs" column on a breakdown row — the reported problem. */
export function breakdownWhatItNeeds(job: MaintenanceJobEntity) {
  return { need: 'breakdown' as const, detail: job.description };
}

const PAPER_LABELS: Record<string, string> = {
  rc: 'RC',
  insurance: 'Insurance',
  permit: 'Permit',
  puc: 'PUC',
  fitness: 'Fitness',
  road_tax: 'Road tax',
};

/** The "What it needs" column on a blocked-on-papers row — which papers to renew, and how long
 *  the oldest has been expired. `documents` is oldest-first (expiredDocuments sorts it). */
export function papersWhatItNeeds(documents: { documentType: string; daysExpired: number }[]) {
  const names = documents.map((d) => PAPER_LABELS[d.documentType] ?? d.documentType).join(', ');
  const days = documents[0]?.daysExpired ?? 0;
  const ago = days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} ago` : 'today';
  return { need: 'papers' as const, detail: `${names} expired ${ago}` };
}

/** The "Workshop intake" column on the in-workshop queue — when it went in and for how long. */
export function toWorkshopIntake(job: MaintenanceJobEntity, now = new Date()) {
  return { since: job.openedAt, ...elapsedDaysHours(job.openedAt, now) };
}

/**
 * Response shape for one job, shared by job history, the breakdowns queue and every write
 * endpoint's response. `canSeeCosts` false strips every money field (not null — absent), so a
 * seat without MAINTENANCE_COSTS_VIEW can't tell a zero-cost job from a hidden one.
 */
export function toJobView(job: MaintenanceJobEntity, canSeeCosts: boolean, now = new Date()) {
  const view = {
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    vehicle: job.vehicle ? toVehicleSummary(job.vehicle) : { id: job.vehicleId },
    serviceType: job.serviceType,
    tyreAction: job.tyreAction,
    tyrePositions: job.tyres?.map((tyre) => tyre.position) ?? undefined,
    openedAt: job.openedAt,
    closedAt: job.closedAt,
    daysTaken: jobDays(job.openedAt, job.closedAt, now),
    odometerKm: job.odometerKm,
    workshopName: job.workshopName,
    locationLabel: job.locationLabel,
    latitude: toNumber(job.latitude),
    longitude: toNumber(job.longitude),
    towed: job.towed,
    description: job.description,
    includesService: job.includesService,
    sourceIssueReportId: job.sourceIssueReportId,
  };

  if (!canSeeCosts) {
    return {
      ...view,
      partsReplaced: job.partsReplaced.map(({ name, quantity }) => ({ name, quantity })),
    };
  }

  return {
    ...view,
    partsReplaced: job.partsReplaced,
    // The invoice shows amounts, so it goes with the money.
    invoiceFileKey: job.invoiceFileKey,
    labourCost: toNumber(job.labourCost),
    partsCost: toNumber(job.partsCost),
    totalCost: toNumber(job.totalCost),
  };
}

/** Breakdowns queue row — a job view plus what the downtime is costing so far. */
export function toBreakdownView(
  job: MaintenanceJobEntity,
  canSeeCosts: boolean,
  marketLoadsCovering: number,
  now = new Date(),
) {
  const base = { ...toJobView(job, canSeeCosts, now), marketLoadsCovering };
  if (!canSeeCosts) return base;

  const fixed = dailyFixedCost(
    job.vehicle?.telemetryMeta?.fixedCostMonthly,
    job.vehicle?.telemetryMeta?.emiAmount,
  );
  return {
    ...base,
    downtimeCost: money(elapsedDays(job.openedAt, job.closedAt, now) * fixed.perDay),
    fixedCostPerDay: money(fixed.perDay),
    fixedCostSource: fixed.source,
  };
}

/**
 * Resolves the three cost columns from a job-cost input:
 *   parts_cost = explicit partsCost, else the sum of the itemised parts' costs (if any priced)
 *   total_cost = labour + parts (null only when neither is known)
 * Only fields the caller actually sent are returned, so a PATCH leaves the others alone —
 * `existing` supplies the current values when only one side changes.
 */
export function resolveJobCosts(
  input: JobCostInput,
  existing?: Pick<MaintenanceJobEntity, 'labourCost' | 'partsCost' | 'partsReplaced'>,
): {
  partsReplaced?: ReplacedPart[];
  labourCost?: string | null;
  partsCost?: string | null;
  totalCost?: string | null;
} {
  if (input.cost !== undefined) {
    // One figure off the invoice — keep any itemised parts list, but the total is what was paid.
    return {
      ...(input.partsReplaced
        ? {
            partsReplaced: input.partsReplaced.map((part) => ({
              name: part.name,
              quantity: part.quantity,
              cost: part.cost ?? null,
            })),
          }
        : {}),
      ...(input.labourCost !== undefined ? { labourCost: String(input.labourCost) } : {}),
      ...(input.partsCost !== undefined ? { partsCost: String(input.partsCost) } : {}),
      totalCost: String(input.cost),
    };
  }

  const touched =
    input.labourCost !== undefined ||
    input.partsCost !== undefined ||
    input.partsReplaced !== undefined;
  if (!touched) return {};

  const partsReplaced: ReplacedPart[] | undefined = input.partsReplaced?.map((part) => ({
    name: part.name,
    quantity: part.quantity,
    cost: part.cost ?? null,
  }));

  const itemised = partsReplaced?.filter((part) => part.cost !== null);
  const partsCost =
    input.partsCost ??
    (itemised && itemised.length > 0
      ? itemised.reduce((sum, part) => sum + (part.cost ?? 0), 0)
      : toNumber(existing?.partsCost ?? null));
  const labourCost = input.labourCost ?? toNumber(existing?.labourCost ?? null);

  const totalCost =
    labourCost === null && partsCost === null ? null : (labourCost ?? 0) + (partsCost ?? 0);

  return {
    ...(partsReplaced ? { partsReplaced } : {}),
    labourCost: labourCost === null ? null : String(labourCost),
    partsCost: partsCost === null ? null : String(partsCost),
    totalCost: totalCost === null ? null : String(totalCost),
  };
}
