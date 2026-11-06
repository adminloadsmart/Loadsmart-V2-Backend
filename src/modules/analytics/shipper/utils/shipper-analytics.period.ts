import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../../shared/utils/ist-time';
import {
  addDays,
  addMonths,
  daysBetween,
  firstOfMonth,
} from '../../../maintenance/calculations/dates';
import { SHIPPER_PERIOD_MONTHS, ShipperAnalyticsPeriod } from './shipper-analytics.constants';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface ShipperMonth {
  /** "YYYY-MM" */
  month: string;
  /** "Mar ’26" for the first month of the window and every January, else "Apr". */
  label: string;
}

export interface ShipperWindow {
  /** IST calendar dates, inclusive. */
  fromDate: string;
  toDate: string;
  /** IST day boundaries as instants. */
  from: Date;
  to: Date;
  days: number;
  /** "01 Mar 26 – 01 Sep 26" */
  label: string;
}

export interface ShipperPeriod {
  current: ShipperWindow;
  /** §1 "Previous period": the same length immediately before the selected one. */
  previous: ShipperWindow;
  months: ShipperMonth[];
}

function shortDate(date: string): string {
  return `${date.slice(8, 10)} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}`;
}

function windowOf(fromDate: string, toDate: string): ShipperWindow {
  return {
    fromDate,
    toDate,
    from: startOfIstDate(fromDate),
    to: endOfIstDate(toDate),
    days: daysBetween(fromDate, toDate) + 1,
    label: `${shortDate(fromDate)} – ${shortDate(toDate)}`,
  };
}

/** Every calendar month the window touches, oldest first. */
function monthsOf(fromDate: string, toDate: string): ShipperMonth[] {
  const months: ShipperMonth[] = [];
  for (let start = firstOfMonth(fromDate); start <= toDate; start = addMonths(start, 1)) {
    const name = MONTH_NAMES[Number(start.slice(5, 7)) - 1];
    const withYear = months.length === 0 || start.slice(5, 7) === '01';
    months.push({
      month: start.slice(0, 7),
      label: withYear ? `${name} ’${start.slice(2, 4)}` : name,
    });
  }
  return months;
}

/**
 * §1 / §6 — the selected period and the one before it. A preset of N months ends today and starts
 * the same day N months earlier; a custom range is used as given. The previous period has exactly
 * as many days and ends the day before the selected one starts.
 */
export function resolveShipperPeriod(
  period: ShipperAnalyticsPeriod,
  from?: string,
  to?: string,
  now = new Date(),
): ShipperPeriod {
  let fromDate: string;
  let toDate: string;
  if (period === 'custom') {
    // The validator requires both for custom.
    fromDate = from!;
    toDate = to!;
  } else {
    toDate = toIstDateString(now);
    fromDate = addMonths(toDate, -SHIPPER_PERIOD_MONTHS[period]);
  }

  const current = windowOf(fromDate, toDate);
  const previousTo = addDays(fromDate, -1);
  const previous = windowOf(addDays(previousTo, -(current.days - 1)), previousTo);
  return { current, previous, months: monthsOf(fromDate, toDate) };
}

/** True when the instant falls inside the window (both ends inclusive). */
export function inWindow(at: Date | null, window: ShipperWindow): at is Date {
  return at !== null && at >= window.from && at <= window.to;
}
