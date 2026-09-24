import {
  DEFAULT_AVG_DAILY_KM,
  DEFAULT_TYRE_WEAR_MM_PER_1000KM,
  LEGAL_TREAD_FLOOR_MM,
  TREAD_WARN_PCT,
  TYRE_QUEUE_HORIZON_DAYS,
} from '../maintenance.constants';
import { TyreCasingCondition, TyreNextStep } from '../maintenance.types';
import { daysBetween, round } from './dates';

export interface TyreWearInput {
  originalTreadMm: number;
  fittedAt: string;
  fittedOdometerKm: number;
  /** The vehicle's current odometer, if known. */
  vehicleOdometerKm: number | null;
  latestReading: { treadMm: number; readingDate: string; odometerKm: number | null } | null;
  retreadCount: number;
  maxRetreads: number;
  casingCondition: TyreCasingCondition;
  today: string;
}

export interface TyreWearResult {
  currentTreadMm: number;
  /** True when currentTreadMm or the wear rate came from DEFAULT_TYRE_WEAR_MM_PER_1000KM rather
   *  than this tyre's own gauge reading. */
  estimated: boolean;
  wearMmPer1000Km: number;
  /** Share of usable tread (original down to the legal floor) still left, 0–100. */
  usableTreadLeftPct: number;
  kmToLegalFloor: number;
  daysToLegalFloor: number;
  atLegalLimit: boolean;
  /** Under TREAD_WARN_PCT but still above the legal floor. */
  nearLimit: boolean;
  inQueue: boolean;
  nextStep: TyreNextStep;
}

/**
 *   kmSinceFit      = (odometer at reading, else vehicle odometer) − fitted odometer
 *   wear rate       = (original − current) / kmSinceFit × 1000       mm per 1000 km
 *                     (DEFAULT_TYRE_WEAR_MM_PER_1000KM when no distance or no wear yet)
 *   current tread   = latest gauge reading; with none, original − vehicle km since fit / 1000
 *                     × default wear, flagged `estimated`
 *   km to floor     = (current − 1.6) / wear rate × 1000
 *   days to floor   = km to floor / average daily km (vehicle km since fit / days since fit,
 *                     else DEFAULT_AVG_DAILY_KM)
 *   next step       = scrap if the casing is damaged, retread while retreads are left, else new
 */
export function computeTyreWear(input: TyreWearInput): TyreWearResult {
  const {
    originalTreadMm,
    fittedAt,
    fittedOdometerKm,
    vehicleOdometerKm,
    latestReading,
    retreadCount,
    maxRetreads,
    casingCondition,
    today,
  } = input;

  const vehicleKmSinceFit =
    vehicleOdometerKm !== null ? Math.max(0, vehicleOdometerKm - fittedOdometerKm) : 0;

  let currentTreadMm: number;
  let wearMmPer1000Km = DEFAULT_TYRE_WEAR_MM_PER_1000KM;
  let estimated = true;

  if (latestReading) {
    currentTreadMm = latestReading.treadMm;
    const odometerAtReading = latestReading.odometerKm ?? vehicleOdometerKm;
    const kmAtReading =
      odometerAtReading !== null ? Math.max(0, odometerAtReading - fittedOdometerKm) : 0;
    const worn = originalTreadMm - latestReading.treadMm;
    if (kmAtReading > 0 && worn > 0) {
      wearMmPer1000Km = (worn / kmAtReading) * 1000;
      estimated = false;
    }
  } else {
    currentTreadMm = Math.max(
      0,
      originalTreadMm - (vehicleKmSinceFit / 1000) * DEFAULT_TYRE_WEAR_MM_PER_1000KM,
    );
  }

  const daysSinceFit = daysBetween(fittedAt, today);
  const avgDailyKm =
    vehicleKmSinceFit > 0 && daysSinceFit > 0
      ? vehicleKmSinceFit / daysSinceFit
      : DEFAULT_AVG_DAILY_KM;

  const treadAboveFloor = Math.max(0, currentTreadMm - LEGAL_TREAD_FLOOR_MM);
  const usableTread = Math.max(0.1, originalTreadMm - LEGAL_TREAD_FLOOR_MM);
  const usableTreadLeftPct = Math.min(100, (treadAboveFloor / usableTread) * 100);

  const kmToLegalFloor = (treadAboveFloor / wearMmPer1000Km) * 1000;
  const daysToLegalFloor = kmToLegalFloor / avgDailyKm;

  const atLegalLimit = currentTreadMm <= LEGAL_TREAD_FLOOR_MM;
  const nearLimit = !atLegalLimit && usableTreadLeftPct < TREAD_WARN_PCT;

  const nextStep: TyreNextStep =
    casingCondition === 'damaged' ? 'scrap' : retreadCount < maxRetreads ? 'retread' : 'new_tyre';

  return {
    currentTreadMm: round(currentTreadMm, 1),
    estimated,
    wearMmPer1000Km: round(wearMmPer1000Km, 3),
    usableTreadLeftPct: round(usableTreadLeftPct, 1),
    kmToLegalFloor: Math.round(kmToLegalFloor),
    daysToLegalFloor: Math.floor(daysToLegalFloor),
    atLegalLimit,
    nearLimit,
    inQueue: atLegalLimit || nearLimit || daysToLegalFloor <= TYRE_QUEUE_HORIZON_DAYS,
    nextStep,
  };
}
