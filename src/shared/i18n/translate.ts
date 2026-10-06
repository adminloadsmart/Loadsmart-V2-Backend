import { en } from './catalog/en';
import { hi } from './catalog/hi';
import { DEFAULT_LOCALE, Locale } from './locales';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

type StripPlural<K extends string> = K extends `${infer B}_one`
  ? B
  : K extends `${infer B}_other`
    ? B
    : K;

// Every key in en.ts, with `_one` / `_other` plural pairs collapsed to their base name.
export type MessageKey = StripPlural<Leaves<typeof en>>;

export type MessageParams = Record<string, string | number>;

// A key plus its params: what AppError carries instead of finished English text.
export interface MessageRef {
  key: MessageKey;
  params?: MessageParams;
}

export const msg = (key: MessageKey, params?: MessageParams): MessageRef => ({ key, params });

type Node = { readonly [k: string]: string | Node };

const CATALOGS: Record<Locale, Node> = { en, hi };

const pluralRules = new Map<Locale, Intl.PluralRules>();
const selectPlural = (locale: Locale, count: number): Intl.LDMLPluralRule => {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
};

const lookup = (locale: Locale, key: string): string | undefined => {
  let node: string | Node | undefined = CATALOGS[locale];
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
};

const resolveRaw = (locale: Locale, key: string, params?: MessageParams): string | undefined => {
  if (typeof params?.count === 'number') {
    const plural =
      lookup(locale, `${key}_${selectPlural(locale, params.count)}`) ??
      lookup(locale, `${key}_other`);
    if (plural !== undefined) return plural;
  }
  return lookup(locale, key);
};

const interpolate = (template: string, params?: MessageParams): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        name in params ? String(params[name]) : placeholder,
      )
    : template;

// Falls back locale -> en -> the key itself, so a gap in a catalog degrades to readable English
// (or at worst the key) instead of throwing mid-request.
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template =
    resolveRaw(locale, key, params) ?? resolveRaw(DEFAULT_LOCALE, key, params) ?? key;
  return interpolate(template, params);
}

// For strings that arrive untyped (a Zod issue message, an enum value): true only when `value`
// is a real catalog key, so callers can translate it and leave ordinary text alone.
export const isMessageKey = (value: string): value is MessageKey =>
  lookup(DEFAULT_LOCALE, value) !== undefined ||
  lookup(DEFAULT_LOCALE, `${value}_other`) !== undefined;

export const translateIfKey = (locale: Locale, value: string, params?: MessageParams): string =>
  isMessageKey(value) ? t(locale, value, params) : value;
