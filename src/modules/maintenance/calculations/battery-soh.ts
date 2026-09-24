import { BatteryVerdict } from '../maintenance.types';
import { fromMonthIndex, monthIndex, round } from './dates';

export interface BatterySohInput {
  readings: { readingMonth: string; sohPct: number }[];
  floorPct: number;
  warrantyEnd: string;
}

export interface BatterySohResult {
  /** Oldest first. */
  series: { month: string; sohPct: number }[];
  latestSohPct: number | null;
  /** Percentage points of SoH lost per month (positive = degrading). Null with < 2 readings. */
  degradationPctPerMonth: number | null;
  /** When SoH reaches the warranty floor — the actual month if it already has, else projected. */
  floorReachedOn: string | null;
  alreadyBelowFloor: boolean;
  verdict: BatteryVerdict;
}

/**
 * The only battery question that matters to the shipper: does the pack cross its warranty SoH
 * floor before or after the warranty ends?
 *
 *   trend        = least-squares line through (month, SoH) over every monthly reading
 *   floor date   = the first month at/below the floor if it has happened, else where the trend
 *                  line meets the floor
 *   verdict      = manufacturer   if floor date ≤ warranty end (a warranty claim)
 *                  capital_call   if floor date > warranty end (the shipper pays for a pack)
 *                  insufficient_data with < 2 readings or no downward trend, and not yet crossed
 */
export function computeBatterySoh(input: BatterySohInput): BatterySohResult {
  const series = [...input.readings]
    .sort((a, b) => a.readingMonth.localeCompare(b.readingMonth))
    .map((r) => ({ month: r.readingMonth, sohPct: r.sohPct }));

  const latestSohPct = series.length ? series[series.length - 1].sohPct : null;
  const slope = series.length >= 2 ? leastSquaresSlope(series) : null;
  const degradationPctPerMonth = slope === null ? null : round(-slope, 2);

  const crossed = series.find((r) => r.sohPct <= input.floorPct);
  let floorReachedOn: string | null = crossed?.month ?? null;

  if (!crossed && slope !== null && slope < 0) {
    const xs = series.map((r) => monthIndex(r.month));
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = series.reduce((a, r) => a + r.sohPct, 0) / series.length;
    const intercept = meanY - slope * meanX;
    floorReachedOn = fromMonthIndex((input.floorPct - intercept) / slope);
  }

  const verdict: BatteryVerdict =
    floorReachedOn === null
      ? 'insufficient_data'
      : floorReachedOn <= input.warrantyEnd
        ? 'manufacturer'
        : 'capital_call';

  return {
    series,
    latestSohPct,
    degradationPctPerMonth,
    floorReachedOn,
    alreadyBelowFloor: Boolean(crossed),
    verdict,
  };
}

function leastSquaresSlope(series: { month: string; sohPct: number }[]): number | null {
  const xs = series.map((r) => monthIndex(r.month));
  const ys = series.map((r) => r.sohPct);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}
