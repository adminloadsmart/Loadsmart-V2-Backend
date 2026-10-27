import type { LoadEntity } from '../entities/load.entity';
import type { LoadVerificationEntity } from '../verification/load-verification.entity';
import type { UlipVahanResult } from '../../../adapters/ulip.client';
import type { VerificationStatus } from './loads.types';

/** Truck (VAHAN) and driver (Sarathi) checks on a load (verification/). */

/** The load fields a driver check reads — the truck's weight comes from its vehicle or check. */
export type DriverCheckLoad = Pick<LoadEntity, 'id' | 'vehicleId' | 'vehicleNumber'>;

/** The load fields a truck check reads. */
export type TruckCheckLoad = Pick<LoadEntity, 'id' | 'vehicleNumber'>;

export type CreateLoadVerificationData = Omit<LoadVerificationEntity, 'id' | 'load' | 'createdAt'>;

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
  checkedAt: string;
}

export interface LoadChecksView {
  truck: CheckView | null;
  driver: CheckView | null;
  /** True when nothing failed — what the memo waits on. `unavailable` never blocks. */
  clear: boolean;
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
