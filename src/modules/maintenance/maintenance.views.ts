import { MaintenanceJobEntity, ReplacedPart } from './entities/maintenance-job.entity';
import { dailyFixedCost, elapsedDays, jobDays, money } from './calculations/downtime';
import { JobCostInput } from './maintenance.interface';

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

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
    vehicle: job.vehicle
      ? { id: job.vehicle.id, registrationNumber: job.vehicle.registrationNumber }
      : { id: job.vehicleId },
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
