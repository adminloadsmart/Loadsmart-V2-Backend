// Adding a language: add its code here, add catalog/<code>.ts (typed against en.ts, so a missing
// key is a compile error), register it in translate.ts's CATALOGS and in format.ts's LOCALE_TAGS.
export const SUPPORTED_LOCALES = ['en', 'hi'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
