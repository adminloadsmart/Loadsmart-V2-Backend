import {
  INDIAN_NUMBER_LOCALE,
  REPORTING_TIME_FORMAT_OPTIONS,
  TEMPLATE_VALUE_NOT_GIVEN,
} from '../messaging.constants';

const reportingTimeFormat = new Intl.DateTimeFormat(
  INDIAN_NUMBER_LOCALE,
  REPORTING_TIME_FORMAT_OPTIONS,
);

/** "15 Nov, 10:00 am" in India time — the reporting time on an offer. */
export function formatReportingTime(at: Date | null): string {
  return at ? reportingTimeFormat.format(at) : TEMPLATE_VALUE_NOT_GIVEN;
}

/** "45,000" — rupees without paise, Indian grouping. */
export function formatRupees(rate: string): string {
  return Number(rate).toLocaleString(INDIAN_NUMBER_LOCALE, { maximumFractionDigits: 0 });
}

/** "32" or "32.5" tonnes for {{weight}}; "-" when not posted. */
export function formatTonnes(weightTonnes: string | null): string {
  if (!weightTonnes || !Number(weightTonnes)) return TEMPLATE_VALUE_NOT_GIVEN;
  return String(Number(weightTonnes));
}
