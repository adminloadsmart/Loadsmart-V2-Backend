import { Locale } from './locales';

const LOCALE_TAGS: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN' };

// Dates are shown in IST regardless of the server's timezone: every user of this API is in India.
const TIME_ZONE = 'Asia/Kolkata';

export const formatDate = (
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string =>
  new Intl.DateTimeFormat(LOCALE_TAGS[locale], { timeZone: TIME_ZONE, ...options }).format(
    new Date(value),
  );

export const formatNumber = (
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string => new Intl.NumberFormat(LOCALE_TAGS[locale], options).format(value);

export const formatMoney = (amount: number, locale: Locale): string =>
  new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
