import { ageFromDateOfBirth } from '../shared/utils/date';

/**
 * Provider-agnostic driving-licence verification contract. `SarathiClient` implements this; a
 * future swap to `UlipClient` (SARATHI DL + VAHAN, see feat/ulip-integration) only needs to
 * satisfy this same shape — no call site outside the composition root needs to change.
 */
export interface DlVerificationClient {
  lookupDrivingLicence(
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult>;
}

/**
 * Result of a driving-licence lookup against the Sarathi registry. No registry is currently
 * queried (see SarathiClient), so every lookup is `manual_review` without registry fields.
 */
export interface SarathiDrivingLicenceResult {
  status: 'verified' | 'manual_review';
  holderName?: string;
  validUntil?: string;
  /** Every class of vehicle on the licence, e.g. "MCWG, LMV, HGMV". */
  licenseClass?: string;
  /** Only the transport (commercial) classes, e.g. "HGMV, HPMV" — absent for a non-transport DL. */
  transportClass?: string;
  /** Holder's age in whole years, from the date of birth sent with the lookup — always set, even
   * on the fallback paths where the registry returned nothing. */
  age?: number;
  licenseStatus?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  rawResponse?: Record<string, unknown>;
}

/**
 * Placeholder licence verifier: no external registry is called, so nothing is confirmed. Every
 * lookup resolves `manual_review` with only the age derived from the date of birth — the licence
 * is never marked `verified` without a registry answer. Replace the body with a real provider
 * (e.g. ULIP SARATHI) when one is available — the contract above is unchanged.
 */
export class SarathiClient implements DlVerificationClient {
  async lookupDrivingLicence(
    _licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    return { status: 'manual_review', age: ageFromDateOfBirth(dateOfBirth) };
  }
}
