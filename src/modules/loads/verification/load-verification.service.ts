import { rethrow } from '../../../shared/errors';
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
  TruckCheckLoad,
  VehicleRegistryClient,
} from '../utils/load-verification.interface';

/** A conclusive check of the same truck/licence this recent is reused instead of a new lookup. */
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const toCheckView = (check: LoadVerificationEntity): CheckView => ({
  id: check.id,
  subject: check.subject,
  subjectRef: check.subjectRef,
  status: check.status,
  failures: check.failures,
  notes: check.notes,
  checkedAt: check.checkedAt.toISOString(),
});

const statusOf = (failures: string[]): VerificationStatus =>
  failures.length ? 'failed' : 'passed';

/**
 * Govt-portal checks of the truck and driver put on a load: the truck on VAHAN (via ULIP) when a
 * bid or indent names it, the driver on Sarathi when the transporter names them. Every check is
 * stored on the load (load_verifications). A failed truck keeps the bid's Accept off; a failed
 * truck or driver keeps the load memo from going out. A portal that can't be reached records
 * `unavailable` and doesn't block — the same policy the driver onboarding check follows.
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
      const result = await this.dlClient.lookupDrivingLicence(
        input.licenceNumber,
        input.dateOfBirth,
      );
      const grossVehicleWeightKg = await this.grossWeightOf(tenantId, load);

      const failures: string[] = [];
      const notes: string[] = [];
      if (result.status === 'manual_review') {
        failures.push('Licence not found on Sarathi — check the licence number and date of birth');
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
      return {
        truck: truck ? toCheckView(truck) : null,
        driver: driver ? toCheckView(driver) : null,
        clear: truck?.status !== 'failed' && driver?.status !== 'failed',
      };
    } catch (error) {
      rethrow(error, 'Failed to read the load checks');
    }
  }
}

/** What a check means for a bid's truck: passed → verified, failed → not, otherwise unknown. */
export function truckVerifiedOf(check: LoadVerificationEntity): boolean | null {
  if (check.status === 'passed') return true;
  if (check.status === 'failed') return false;
  return null;
}
