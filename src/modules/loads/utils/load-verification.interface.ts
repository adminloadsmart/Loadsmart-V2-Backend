import type { LoadEntity } from '../entities/load.entity';
import type { LoadVerificationEntity } from '../verification/load-verification.entity';
import type { UlipVahanResult } from '../../../adapters/ulip.client';
import type { VerificationStatus } from './loads.types';

/** Truck (VAHAN) and driver (Sarathi) checks on a load (verification/). */

/** The load fields a driver check reads — the truck's weight comes from its vehicle or check. */
export type DriverCheckLoad = Pick<LoadEntity, 'id' | 'vehicleId' | 'vehicleNumber'>;

/** The load fields a truck check reads. */
export type TruckCheckLoad = Pick<LoadEntity, 'id' | 'vehicleNumber'>;

export type CreateLoadVerificationData = Omit<
  LoadVerificationEntity,
  'id' | 'load' | 'createdAt' | 'source' | 'verifiedBy'
> &
  Partial<Pick<LoadVerificationEntity, 'source' | 'verifiedBy'>>;

/** The VAHAN lookup this service needs — UlipClient satisfies it. */
export interface VehicleRegistryClient {
  lookupVehicle(vehicleNumber: string): Promise<UlipVahanResult>;
}

export interface DriverCheckInput {
  licenceNumber: string;
  /** YYYY-MM-DD — Sarathi needs it with the licence number. */
  dateOfBirth: string;
}

export interface CheckView {
  id: string;
  subject: LoadVerificationEntity['subject'];
  subjectRef: string;
  status: VerificationStatus;
  /** Only the failures are shown to the shipper. */
  failures: string[];
  notes: string[];
  /** 'manual' when an admin verified it by hand (VAHAN down, or Sarathi couldn't confirm). */
  source: LoadVerificationEntity['source'];
  verifiedBy: string | null;
  /** Truck only: RC, fitness, insurance, PUC and permit validity dates; null for a driver or when
   *  the portal returned nothing. */
  papers: TruckPapers | null;
  checkedAt: string;
}

export interface LoadChecksView {
  truck: CheckView | null;
  driver: CheckView | null;
  /** True when both checks passed — what the memo waits on. A check that couldn't run blocks. */
  clear: boolean;
  /** Why it isn't clear, one line each. */
  blockers: string[];
  /** The truck check couldn't run on VAHAN, so an admin (trucks.verify_manual, or
   *  loadsmart.truck.verify_manual on a Loadsmart load) may verify it by hand. */
  truckManualAllowed: boolean;
  /** Sarathi couldn't confirm the licence (not found, or not reachable), so an admin
   *  (drivers.verify_manual, or loadsmart.driver.verify_manual on a Loadsmart load) may verify
   *  it by hand. A Sarathi verdict — expired, or the wrong class — can't be overridden. */
  driverManualAllowed: boolean;
  /** Links to the licence photos and the RC copy — only sent for a check the govt portal did not
   *  pass by itself (couldn't run, failed, or verified by hand), so they can be read by eye. */
  photos?: { licenceFront: string | null; licenceBack: string | null; rcCopy: string | null };
}

/** An admin's manual licence check: they saw the licence (the checkbox), plus its validity date if
 *  they read it off the card (an expired date still fails the check). */
export interface ManualDriverCheckInput {
  licenceChecked: true;
  validUntil?: string;
  note?: string;
}

/** An admin's manual truck check while VAHAN is down: the RC checkbox, plus any paper expiry
 *  dates they read off the papers (an expired one still fails the check). */
export interface ManualTruckCheckInput {
  rcChecked: true;
  papers?: TruckPapers;
  note?: string;
}

/** The truck papers checked on VAHAN — RC, fitness, insurance, PUC, permit. */
export interface TruckPapers {
  rcValidTo?: string;
  fitnessValidTo?: string;
  insuranceValidTo?: string;
  pucValidTo?: string;
  permitValidTo?: string;
}

export type LicenceClassVerdict =
  | { ok: true }
  | { ok: false; reason: string }
  /** Not enough data to judge (truck weight or licence classes unknown) — never blocks. */
  | { ok: null; reason: string };
