/**
 * Pure govt-portal check rules for a truck and driver put on a load — no DB/IO, unit-tested in
 * verification-rules.test.ts. LoadVerificationService runs the lookups and applies these.
 */

/** "A truck above 7.5 t needs a transport licence. Up to 7.5 t, an LMV licence is enough." */
export const TRANSPORT_LICENCE_GVW_KG = 7500;

/** The truck papers checked on VAHAN — RC, fitness, insurance, PUC, permit. */
export interface TruckPapers {
  rcValidTo?: string;
  fitnessValidTo?: string;
  insuranceValidTo?: string;
  pucValidTo?: string;
  permitValidTo?: string;
}

const PAPER_LABELS: Record<keyof TruckPapers, string> = {
  rcValidTo: 'RC',
  fitnessValidTo: 'Fitness',
  insuranceValidTo: 'Insurance',
  pucValidTo: 'PUC',
  permitValidTo: 'Permit',
};

/** YYYY-MM-DD in India time — the day a paper's "valid to" date is compared against. */
export function istDateOf(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** One failure per paper whose validity date has passed. A paper VAHAN leaves blank isn't held
 *  against the truck — only a dated, expired one fails. */
export function expiredPaperFailures(papers: TruckPapers, today: string): string[] {
  return (Object.keys(PAPER_LABELS) as (keyof TruckPapers)[])
    .filter((key) => papers[key] && papers[key]! < today)
    .map((key) => `${PAPER_LABELS[key]} expired on ${papers[key]}`);
}

/** Transport (commercial) classes of vehicle as they appear on Indian licences. */
const TRANSPORT_CLASSES = [
  'TRANS',
  'TRANSPORT',
  'HGMV',
  'HPMV',
  'HMV',
  'HTV',
  'MGV',
  'MPMV',
  'MMV',
  'LGV',
  'LMV-TR',
  'LMVTR',
];
const LMV_CLASSES = ['LMV', 'LMV-NT', 'LMVNT'];

const classTokens = (value: string | null | undefined): string[] =>
  (value ?? '')
    .toUpperCase()
    .split(/[\s,;/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

export type LicenceClassVerdict =
  | { ok: true }
  | { ok: false; reason: string }
  /** Not enough data to judge (truck weight or licence classes unknown) — never blocks. */
  | { ok: null; reason: string };

/** Does the licence cover a truck of this gross vehicle weight? */
export function licenceClassVerdict(
  grossVehicleWeightKg: number | null | undefined,
  licenseClass: string | null | undefined,
  transportClass: string | null | undefined,
): LicenceClassVerdict {
  const classes = [...classTokens(licenseClass), ...classTokens(transportClass)];
  if (!grossVehicleWeightKg) return { ok: null, reason: 'Truck weight unknown' };
  if (!classes.length) return { ok: null, reason: 'Licence classes unknown' };

  const hasTransport =
    classTokens(transportClass).length > 0 ||
    classes.some((token) => TRANSPORT_CLASSES.includes(token));
  if (grossVehicleWeightKg > TRANSPORT_LICENCE_GVW_KG) {
    return hasTransport
      ? { ok: true }
      : {
          ok: false,
          reason: `A ${grossVehicleWeightKg} kg truck needs a transport licence — this licence has ${classes.join(', ')}`,
        };
  }
  const hasLmv = hasTransport || classes.some((token) => LMV_CLASSES.includes(token));
  return hasLmv
    ? { ok: true }
    : { ok: false, reason: `This licence (${classes.join(', ')}) doesn't cover an LMV` };
}

/** A registry date as YYYY-MM-DD — Sarathi sends either ISO or DD-MM-YYYY / DD/MM/YYYY. */
export function toIsoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(value.trim());
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
}

/** Failure when the licence's validity date has passed, else null. */
export function licenceExpiryFailure(validUntil: string | null | undefined, today: string) {
  const day = toIsoDay(validUntil);
  return day && day < today ? `Licence expired on ${day}` : null;
}
