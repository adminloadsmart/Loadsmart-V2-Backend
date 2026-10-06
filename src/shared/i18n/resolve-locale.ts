import { DEFAULT_LOCALE, isLocale, Locale } from './locales';

// Where the locale came from. 'default' means the client expressed no usable preference, which is
// the only case where a later stored-preference lookup (see PR 2) is allowed to take over.
export type LocaleSource = 'query' | 'header' | 'default';

// Parses `Accept-Language: hi-IN,hi;q=0.9,en;q=0.5` and returns the highest-q supported language
// (matched on the primary subtag, so hi-IN -> hi). q=0 means "not acceptable"; `*` is ignored.
export function parseAcceptLanguage(header: string | undefined): Locale | undefined {
  if (!header) return undefined;

  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam === undefined ? 1 : Number(qParam.slice(2));
      return { primary: tag.trim().toLowerCase().split('-')[0], q, index };
    })
    .filter(({ primary, q }) => isLocale(primary) && Number.isFinite(q) && q > 0)
    // Stable on ties: earlier in the header wins.
    .sort((a, b) => b.q - a.q || a.index - b.index);

  return ranked[0]?.primary as Locale | undefined;
}

export function resolveLocale(input: { query?: unknown; acceptLanguage?: string }): {
  locale: Locale;
  source: LocaleSource;
} {
  if (isLocale(input.query)) return { locale: input.query, source: 'query' };

  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return { locale: fromHeader, source: 'header' };

  return { locale: DEFAULT_LOCALE, source: 'default' };
}
