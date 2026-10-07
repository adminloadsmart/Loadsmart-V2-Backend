import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../../shared/utils/ist-time';
import {
  addDays,
  addMonths,
  daysBetween,
  firstOfMonth,
} from '../../../maintenance/calculations/dates';
import { FleetAnalyticsPeriod, PERIOD_MONTHS } from './fleet-analytics.constants';

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

export interface MonthWindow {
  /** "YYYY-MM" */
  month: string;
  from: Date;
  to: Date;
}

export interface FleetPeriod {
  /** IST calendar dates, inclusive. */
  fromDate: string;
  toDate: string;
  /** IST day boundaries as instants, for Between()/overlap arithmetic. */
  from: Date;
  to: Date;
  days: number;
  label: string;
  months: MonthWindow[];
}

function monthLabel(date: string, withYear: boolean): string {
  const name = MONTH_NAMES[Number(date.slice(5, 7)) - 1];
  return withYear ? `${name} ${date.slice(2, 4)}` : name;
}

function lastDayOfMonth(date: string): string {
  return addDays(addMonths(firstOfMonth(date), 1), -1);
}

/** "Mar to Aug 26", "Sep 26", "Nov 25 to Apr 26", or "12 Mar to 20 Aug 26" for a custom range
 *  that doesn't start and end on month boundaries. */
function buildLabel(fromDate: string, toDate: string): string {
  const wholeMonths = fromDate.endsWith('-01') && toDate === lastDayOfMonth(toDate);
  const sameYear = fromDate.slice(0, 4) === toDate.slice(0, 4);

  if (!wholeMonths) {
    const day = (d: string) => String(Number(d.slice(8, 10)));
    return `${day(fromDate)} ${monthLabel(fromDate, !sameYear)} to ${day(toDate)} ${monthLabel(toDate, true)}`;
  }
  if (fromDate.slice(0, 7) === toDate.slice(0, 7)) return monthLabel(toDate, true);
  return `${monthLabel(fromDate, !sameYear)} to ${monthLabel(toDate, true)}`;
}

/** Every calendar month the range touches, each clipped to the range. */
function buildMonths(fromDate: string, toDate: string): MonthWindow[] {
  const months: MonthWindow[] = [];
  for (let start = firstOfMonth(fromDate); start <= toDate; start = addMonths(start, 1)) {
    const monthFrom = start < fromDate ? fromDate : start;
    const end = lastDayOfMonth(start);
    const monthTo = end > toDate ? toDate : end;
    months.push({
      month: start.slice(0, 7),
      from: startOfIstDate(monthFrom),
      to: endOfIstDate(monthTo),
    });
  }
  return months;
}

/** Turns the filter bar's period into concrete IST dates. Presets are the last N whole calendar
 *  months, ending with last month. */
export function resolveFleetPeriod(
  period: FleetAnalyticsPeriod,
  from?: string,
  to?: string,
  now = new Date(),
): FleetPeriod {
  let fromDate: string;
  let toDate: string;

  if (period === 'custom') {
    // The validator requires both for custom.
    fromDate = from!;
    toDate = to!;
  } else {
    const thisMonth = firstOfMonth(toIstDateString(now));
    fromDate = addMonths(thisMonth, -PERIOD_MONTHS[period]);
    toDate = addDays(thisMonth, -1);
  }

  return {
    fromDate,
    toDate,
    from: startOfIstDate(fromDate),
    to: endOfIstDate(toDate),
    days: daysBetween(fromDate, toDate) + 1,
    label: buildLabel(fromDate, toDate),
    months: buildMonths(fromDate, toDate),
  };
}
