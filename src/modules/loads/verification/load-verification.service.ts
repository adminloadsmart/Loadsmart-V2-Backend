import { ConflictError, rethrow } from '../../../shared/errors';
import { UlipError } from '../../../adapters/ulip.client';
import { DlVerificationClient } from '../../../adapters/sarathi.client';
import { VerificationStatus } from '../utils/loads.types';
import { LoadVerificationEntity } from './load-verification.entity';
import { LoadVerificationRepository } from './load-verification.repository';
import {
  expiredPaperFailures,
  istDateOf,
  licenceClassVerdict,
  licenceExpiryFailure,
  toIsoDay,
} from './verification-rules';
import {
  CheckView,
  CreateLoadVerificationData,
  DriverCheckInput,
  DriverCheckLoad,
  LoadChecksView,
  ManualDriverCheckInput,
  ManualTruckCheckInput,
  TruckCheckLoad,
  TruckPapers,
  VehicleRegistryClient,
} from '../utils/load-verification.interface';

/** Sarathi had no match for the licence and date of birth — it couldn't confirm it either way, so
 *  an admin may verify it by hand (unlike an expired licence or the wrong class). */
export const DL_NOT_FOUND_FAILURE =
  'Licence not found on Sarathi — check the licence number and date of birth';

/** Sarathi couldn't confirm the licence: it wasn't reachable, or it found no match. Only then may
 *  an admin verify the driver by hand. */
export function driverManualAllowedFor(
  check: Pick<LoadVerificationEntity, 'status' | 'failures' | 'source'> | null,
): boolean {
  if (!check || check.source === 'manual') return false;
  if (check.status === 'unavailable') return true;
  return (
    check.status === 'failed' &&
    check.failures.length > 0 &&
    check.failures.every((failure) => failure === DL_NOT_FOUND_FAILURE)
  );
}

/** A conclusive check of the same truck/licence this recent is reused instead of a new lookup. */
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const toCheckView = (check: LoadVerificationEntity): CheckView => ({
  id: check.id,
  subject: check.subject,
  subjectRef: check.subjectRef,
  status: check.status,
  failures: check.failures,
  notes: check.notes,
  source: check.source,
  verifiedBy: check.verifiedBy,
  // The paper validity dates the truck check used (VAHAN's, or those typed in a manual check) —
  // the "Confirm the truck" screen shows one row per paper.
  papers:
    check.subject === 'truck' ? ((check.details?.papers as TruckPapers | undefined) ?? null) : null,
  checkedAt: check.checkedAt.toISOString(),
});

const statusOf = (failures: string[]): VerificationStatus =>
  failures.length ? 'failed' : 'passed';

/**
 * Govt-portal checks of the truck and driver put on a load: the truck on VAHAN (via ULIP) when a
 * bid or indent names it, the driver on Sarathi when the transporter names them. Every check is
 * stored on the load (load_verifications). A failed truck keeps the bid's Accept off. The load
 * memo goes only when both the truck and the driver checks passed ("every check passes"): a
 * portal that couldn't be reached records `unavailable`, which blocks the memo until the check is
 * run again (checksBlockers).
 */
export class LoadVerificationService {
  constructor(
    private readonly repository: LoadVerificationRepository,
    private readonly vehicleRegistry: VehicleRegistryClient,
    private readonly dlClient: DlVerificationClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Checks a truck number on VAHAN: found, and RC/fitness/insurance/PUC/permit not expired. */
  async verifyTruck(
    tenantId: string,
    loadId: string,
    vehicleNumber: string,
    bidId: string | null = null,
  ): Promise<LoadVerificationEntity> {
    try {
      const now = this.now();
      const reuse = await this.repository.findRecentConclusive(
        tenantId,
        'truck',
        vehicleNumber,
        new Date(now.getTime() - REUSE_WINDOW_MS),
      );
      const base = {
        tenantId,
        loadId,
        bidId,
        subject: 'truck' as const,
        subjectRef: vehicleNumber,
      };
      if (reuse) {
        return await this.repository.create({
          ...base,
          status: reuse.status,
          failures: reuse.failures,
          notes: [...reuse.notes, `Reused the check from ${reuse.checkedAt.toISOString()}`],
          grossVehicleWeightKg: reuse.grossVehicleWeightKg,
          details: reuse.details,
          checkedAt: now,
        });
      }

      let data: CreateLoadVerificationData;
      try {
        const result = await this.vehicleRegistry.lookupVehicle(vehicleNumber);
        const failures =
          result.status === 'not_found'
            ? ['Truck not found on VAHAN']
            : expiredPaperFailures(result.papers, istDateOf(now));
        data = {
          ...base,
          status: statusOf(failures),
          failures,
          notes: [],
          grossVehicleWeightKg: result.grossVehicleWeightKg ?? null,
          details: { papers: result.papers, vehicleClass: result.vehicleClass ?? null },
          checkedAt: now,
        };
      } catch (error) {
        const reason = error instanceof UlipError ? error.code : 'LOOKUP_FAILED';
        data = {
          ...base,
          status: 'unavailable',
          failures: [],
          notes: [`VAHAN check could not run (${reason})`],
          grossVehicleWeightKg: null,
          details: null,
          checkedAt: now,
        };
      }
      return await this.repository.create(data);
    } catch (error) {
      rethrow(error, 'Failed to verify the truck');
    }
  }

  /**
   * VAHAN couldn't be reached for the load's truck, so an admin checks the RC by hand. Allowed only
   * while the latest check of this truck is `unavailable` — a VAHAN verdict (passed or failed)
   * can't be overridden. Any expiry dates they enter are still checked, so an expired paper fails.
   */
  async recordManualTruckCheck(
    tenantId: string,
    load: TruckCheckLoad,
    actorId: string,
    input: ManualTruckCheckInput,
  ): Promise<LoadVerificationEntity> {
    try {
      if (!load.vehicleNumber) throw new ConflictError('The load has no truck number yet');
      const latest = await this.repository.findLatestForLoad(
        tenantId,
        load.id,
        'truck',
        load.vehicleNumber,
      );
      if (!latest || latest.status !== 'unavailable') {
        throw new ConflictError(
          latest?.status === 'failed'
            ? "VAHAN failed this truck, so it can't be verified manually — ask for another truck"
            : latest?.status === 'passed'
              ? 'The truck check already passed'
              : 'Run the truck check first — manual verification is only for when VAHAN is down',
        );
      }
      const now = this.now();
      const papers = input.papers ?? {};
      const failures = expiredPaperFailures(papers, istDateOf(now));
      const notes = ['Verified manually: VAHAN was unavailable, the RC was checked by hand'];
      if (input.note) notes.push(input.note);
      return await this.repository.create({
        tenantId,
        loadId: load.id,
        bidId: null,
        subject: 'truck',
        subjectRef: load.vehicleNumber,
        status: statusOf(failures),
        failures,
        notes,
        grossVehicleWeightKg: latest.grossVehicleWeightKg,
        details: { papers, rcChecked: true },
        source: 'manual',
        verifiedBy: actorId,
        checkedAt: now,
      });
    } catch (error) {
      rethrow(error, 'Failed to verify the truck manually');
    }
  }

  /** Checks a driver's licence on Sarathi: found, not expired, and its class covers the truck
   *  (above 7.5 t GVW needs a transport licence). The truck's weight comes from the load's own
   *  truck check, or the vehicle master for an own-fleet truck. */
  async verifyDriver(
    tenantId: string,
    load: DriverCheckLoad,
    input: DriverCheckInput,
  ): Promise<LoadVerificationEntity> {
    try {
      const now = this.now();
      const grossVehicleWeightKg = await this.grossWeightOf(tenantId, load);
      let result: Awaited<ReturnType<DlVerificationClient['lookupDrivingLicence']>>;
      try {
        result = await this.dlClient.lookupDrivingLicence(input.licenceNumber, input.dateOfBirth);
      } catch (error) {
        // Sarathi down or erroring: record that the check couldn't run (it blocks the memo until
        // it's run again or an admin verifies the licence by hand) instead of failing the request.
        const reason = error instanceof UlipError ? error.code : 'LOOKUP_FAILED';
        console.warn(`Sarathi licence check could not run for load ${load.id} (${reason})`);
        return await this.repository.create({
          tenantId,
          loadId: load.id,
          bidId: null,
          subject: 'driver',
          subjectRef: input.licenceNumber,
          status: 'unavailable',
          failures: [],
          notes: [`Sarathi check could not run (${reason})`],
          grossVehicleWeightKg,
          details: null,
          checkedAt: now,
        });
      }

      const failures: string[] = [];
      const notes: string[] = [];
      if (result.status === 'manual_review') {
        failures.push(DL_NOT_FOUND_FAILURE);
      }
      const expiry = licenceExpiryFailure(result.validUntil, istDateOf(now));
      if (expiry) failures.push(expiry);
      const verdict = licenceClassVerdict(
        grossVehicleWeightKg,
        result.licenseClass,
        result.transportClass,
      );
      if (verdict.ok === false) failures.push(verdict.reason);
      if (verdict.ok === null) notes.push(`Licence class not checked: ${verdict.reason}`);

      return await this.repository.create({
        tenantId,
        loadId: load.id,
        bidId: null,
        subject: 'driver',
        subjectRef: input.licenceNumber,
        status: statusOf(failures),
        failures,
        notes,
        grossVehicleWeightKg,
        details: {
          holderName: result.holderName ?? null,
          validUntil: toIsoDay(result.validUntil),
          licenseClass: result.licenseClass ?? null,
          transportClass: result.transportClass ?? null,
        },
        checkedAt: now,
      });
    } catch (error) {
      rethrow(error, 'Failed to verify the driver');
    }
  }

  /**
   * Sarathi couldn't confirm the load's driver licence (not reachable, or no match), so an admin
   * checks the licence by hand. Allowed only then — an expired licence or the wrong class is a
   * Sarathi verdict and can't be overridden. A validity date they enter is still checked.
   */
  async recordManualDriverCheck(
    tenantId: string,
    load: DriverCheckLoad & { driverLicenceNumber?: string | null },
    actorId: string,
    input: ManualDriverCheckInput,
  ): Promise<LoadVerificationEntity> {
    try {
      if (!load.driverLicenceNumber) throw new ConflictError('Name the driver first');
      const latest = await this.repository.findLatestForLoad(tenantId, load.id, 'driver');
      if (!latest || latest.subjectRef !== load.driverLicenceNumber) {
        throw new ConflictError(
          "Run the licence check first — manual verification is only for when Sarathi can't confirm it",
        );
      }
      if (latest.status === 'passed') throw new ConflictError('The licence check already passed');
      if (!driverManualAllowedFor(latest)) {
        throw new ConflictError(
          "Sarathi failed this licence, so it can't be verified manually — name another driver",
        );
      }
      const now = this.now();
      const failures: string[] = [];
      const expiry = licenceExpiryFailure(input.validUntil, istDateOf(now));
      if (expiry) failures.push(expiry);
      const notes = [
        latest.status === 'unavailable'
          ? 'Verified manually: Sarathi was unavailable, the licence was checked by hand'
          : 'Verified manually: Sarathi had no match, the licence was checked by hand',
        'Licence class not checked on Sarathi',
      ];
      if (input.note) notes.push(input.note);
      return await this.repository.create({
        tenantId,
        loadId: load.id,
        bidId: null,
        subject: 'driver',
        subjectRef: load.driverLicenceNumber,
        status: statusOf(failures),
        failures,
        notes,
        grossVehicleWeightKg: latest.grossVehicleWeightKg,
        details: { licenceChecked: true, validUntil: toIsoDay(input.validUntil) },
        source: 'manual',
        verifiedBy: actorId,
        checkedAt: now,
      });
    } catch (error) {
      rethrow(error, 'Failed to verify the driver manually');
    }
  }

  /** The load's latest driver check is a manual pass of its current licence. */
  async hasManualDriverPass(
    tenantId: string,
    load: { id: string; driverLicenceNumber?: string | null },
  ): Promise<boolean> {
    if (!load.driverLicenceNumber) return false;
    const latest = await this.repository.findLatestForLoad(tenantId, load.id, 'driver');
    return (
      latest?.source === 'manual' &&
      latest.status === 'passed' &&
      latest.subjectRef === load.driverLicenceNumber
    );
  }

  private async grossWeightOf(tenantId: string, load: DriverCheckLoad): Promise<number | null> {
    if (load.vehicleId) {
      const weight = await this.repository.findVehicleGrossWeight(tenantId, load.vehicleId);
      if (weight) return weight;
    }
    if (!load.vehicleNumber) return null;
    const truck = await this.repository.findLatestForLoad(
      tenantId,
      load.id,
      'truck',
      load.vehicleNumber,
    );
    return truck?.grossVehicleWeightKg ?? null;
  }

  /** The load's latest check of its current truck is a manual pass. */
  async hasManualPass(tenantId: string, load: TruckCheckLoad): Promise<boolean> {
    if (!load.vehicleNumber) return false;
    const latest = await this.repository.findLatestForLoad(
      tenantId,
      load.id,
      'truck',
      load.vehicleNumber,
    );
    return latest?.source === 'manual' && latest.status === 'passed';
  }

  /** The load's truck check for its current truck — runs one when there's none yet (e.g. a truck
   *  assigned by hand rather than through a bid). */
  async ensureTruckChecked(
    tenantId: string,
    load: TruckCheckLoad,
  ): Promise<LoadVerificationEntity | null> {
    if (!load.vehicleNumber) return null;
    const existing = await this.repository.findLatestForLoad(
      tenantId,
      load.id,
      'truck',
      load.vehicleNumber,
    );
    return existing ?? this.verifyTruck(tenantId, load.id, load.vehicleNumber);
  }

  /** The latest truck (for the load's current truck) and driver checks on the load. */
  async checksForLoad(tenantId: string, load: TruckCheckLoad): Promise<LoadChecksView> {
    try {
      const [truck, driver] = await Promise.all([
        load.vehicleNumber
          ? this.repository.findLatestForLoad(tenantId, load.id, 'truck', load.vehicleNumber)
          : Promise.resolve(null),
        this.repository.findLatestForLoad(tenantId, load.id, 'driver'),
      ]);
      const blockers = checksBlockers(truck, driver);
      return {
        truck: truck ? toCheckView(truck) : null,
        driver: driver ? toCheckView(driver) : null,
        clear: blockers.length === 0,
        blockers,
        truckManualAllowed: truck?.status === 'unavailable',
        driverManualAllowed: driverManualAllowedFor(driver),
      };
    } catch (error) {
      rethrow(error, 'Failed to read the load checks');
    }
  }
}

/** What keeps the memo from going out: a check not run yet, one that failed, or one whose portal
 *  couldn't be reached (run it again). Empty when both passed. */
export function checksBlockers(
  truck: Pick<LoadVerificationEntity, 'status' | 'failures'> | null,
  driver: Pick<LoadVerificationEntity, 'status' | 'failures'> | null,
): string[] {
  const blockers: string[] = [];
  for (const [label, check, portal] of [
    ['Truck', truck, 'VAHAN'],
    ['Driver', driver, 'Sarathi'],
  ] as const) {
    if (!check) blockers.push(`${label} not checked yet`);
    else if (check.status === 'failed')
      blockers.push(...check.failures.map((f) => `${label}: ${f}`));
    else if (check.status === 'unavailable') {
      blockers.push(
        label === 'Truck'
          ? `Truck check could not run on ${portal} — run the checks again or verify the truck manually`
          : `${label} check could not run on ${portal} — run the checks again or verify the licence manually`,
      );
    }
  }
  return blockers;
}

/** What a check means for a bid's truck: passed → verified, failed → not, otherwise unknown. */
export function truckVerifiedOf(check: LoadVerificationEntity): boolean | null {
  if (check.status === 'passed') return true;
  if (check.status === 'failed') return false;
  return null;
}
