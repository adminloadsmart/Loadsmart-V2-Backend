import { LMV_MAX_GROSS_WEIGHT_KG, TRANSPORT_LICENCE_CLASSES } from './notifications.constants';
import type { LicenceCheckRow, LicenceMismatch } from './notifications.interface';

/**
 * LS_N_0050 — does the driver's licence cover the vehicle and the cargo? Indian rules as of 2026:
 * - Motor Vehicles Act s.10 / Supreme Court (Bajaj Allianz v. Rambha Devi, 6 Nov 2024, upholding
 *   Mukund Dewangan 2017): an LMV licence covers a transport vehicle up to 7,500 kg gross weight;
 *   above that a transport-vehicle class is needed. Since 1994 that is one "transport vehicle"
 *   class — older licences still show MGV / HGMV / HMV / HTV / HPMV, newer ones TRANS.
 * - Central Motor Vehicles Rules, rule 9: carrying hazardous goods needs an endorsement on the
 *   licence, whatever the vehicle's weight (the driver master's 'hazmat' endorsement).
 * Only a confirmed mismatch counts: no class on file (never checked on Sarathi) or no vehicle
 * weight skips the class check.
 */

/** The licence's class codes ("LMV, HGMV" / "LMV-TR" → ['LMV', 'HGMV'] / ['LMV', 'TR']). */
function classCodesOf(licenceClass: string): string[] {
  return licenceClass
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Null when the licence covers the trip, or nothing could be checked. */
export function licenceMismatchOf(
  check: Pick<
    LicenceCheckRow,
    'licenceClass' | 'endorsements' | 'grossVehicleWeightKg' | 'hazardousProducts'
  >,
): LicenceMismatch | null {
  const needsTransportClass =
    check.licenceClass !== null &&
    check.grossVehicleWeightKg !== null &&
    check.grossVehicleWeightKg > LMV_MAX_GROSS_WEIGHT_KG &&
    !classCodesOf(check.licenceClass).some((code) => TRANSPORT_LICENCE_CLASSES.includes(code));
  const needsHazmatEndorsement =
    check.hazardousProducts.length > 0 && !check.endorsements.includes('hazmat');
  return needsTransportClass || needsHazmatEndorsement
    ? { needsTransportClass, needsHazmatEndorsement }
    : null;
}
