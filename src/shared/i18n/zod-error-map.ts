import type { z } from 'zod';
import { Locale } from './locales';
import { t, translateIfKey } from './translate';

type RawIssue = z.core.$ZodRawIssue;

const TYPE_KEYS = ['string', 'number', 'boolean', 'array', 'object', 'date'] as const;
type TypeKey = (typeof TYPE_KEYS)[number];
const isTypeKey = (value: unknown): value is TypeKey =>
  (TYPE_KEYS as readonly unknown[]).includes(value);

const NUMERIC_ORIGINS = ['number', 'int', 'bigint'];
const LIST_ORIGINS = ['array', 'set'];

// Per-parse customizer for Zod v4 (`schema.safeParse(data, { error })`). Zod applies it only to
// issues whose schema set no message of its own, so a hand-written `.min(1, 'x')` message is left
// alone here and instead translated afterwards by validate.middleware.ts when it is a catalog key.
// Returning undefined falls through to Zod's built-in English message.
export const zodErrorMap =
  (locale: Locale) =>
  (issue: RawIssue): string | undefined => {
    switch (issue.code) {
      case 'invalid_type': {
        if (issue.input === undefined) return t(locale, 'validation.required');
        const expected = isTypeKey(issue.expected)
          ? t(locale, `validation.types.${issue.expected}`)
          : String(issue.expected);
        return t(locale, 'validation.invalidType', { expected });
      }
      case 'too_small': {
        const min = Number(issue.minimum);
        if (issue.origin === 'string')
          return t(locale, 'validation.stringMin', { min, count: min });
        if (LIST_ORIGINS.includes(String(issue.origin)))
          return t(locale, 'validation.arrayMin', { min, count: min });
        if (NUMERIC_ORIGINS.includes(String(issue.origin)))
          return t(
            locale,
            issue.inclusive ? 'validation.numberMin' : 'validation.numberMinExclusive',
            { min },
          );
        return undefined;
      }
      case 'too_big': {
        const max = Number(issue.maximum);
        if (issue.origin === 'string')
          return t(locale, 'validation.stringMax', { max, count: max });
        if (LIST_ORIGINS.includes(String(issue.origin)))
          return t(locale, 'validation.arrayMax', { max, count: max });
        if (NUMERIC_ORIGINS.includes(String(issue.origin)))
          return t(
            locale,
            issue.inclusive ? 'validation.numberMax' : 'validation.numberMaxExclusive',
            { max },
          );
        return undefined;
      }
      case 'invalid_format': {
        if (issue.format === 'email') return t(locale, 'validation.email');
        if (issue.format === 'uuid') return t(locale, 'validation.uuid');
        if (issue.format === 'url') return t(locale, 'validation.url');
        if (issue.format === 'regex') return t(locale, 'validation.regex');
        return t(locale, 'validation.invalidFormat');
      }
      case 'invalid_value':
        return t(locale, 'validation.invalidEnum', {
          options: issue.values.map(String).join(', '),
        });
      case 'unrecognized_keys':
        return t(locale, 'validation.unrecognizedKeys', { keys: issue.keys.join(', ') });
      case 'not_multiple_of':
        return t(locale, 'validation.notMultipleOf', { divisor: Number(issue.divisor) });
      case 'custom':
        // A refine() with no message of its own, or one that passed a catalog key as the message.
        return typeof issue.message === 'string'
          ? translateIfKey(locale, issue.message)
          : t(locale, 'validation.invalid');
      default:
        return undefined;
    }
  };
