import { RequestHandler } from 'express';
import { ZodType } from 'zod';
import { ValidationError } from '../errors';
import { DEFAULT_LOCALE } from '../i18n/locales';
import { msg, translateIfKey } from '../i18n/translate';
import { zodErrorMap } from '../i18n/zod-error-map';

export const validate = (schema: ZodType): RequestHandler => {
  return (req, _res, next) => {
    const locale = req.locale ?? DEFAULT_LOCALE;
    const result = schema.safeParse(
      { body: req.body, query: req.query, params: req.params },
      { error: zodErrorMap(locale) },
    );

    if (!result.success) {
      // Same flatten() shape as before, so the client contract is unchanged apart from the text.
      // The mapper covers schema-level messages (e.g. `.refine(..., { message: 'some.key' })`),
      // which Zod doesn't route through zodErrorMap: a catalog key becomes its translation.
      throw new ValidationError(
        msg('validation.failed'),
        result.error.flatten((issue) => translateIfKey(locale, issue.message)),
      );
    }

    const parsed = result.data as { body?: unknown; query?: unknown; params?: unknown };
    if (parsed.body !== undefined) req.body = parsed.body;
    // req.query has no setter in Express 5 (it's a getter that re-parses req.url on every
    // access), so the coerced/defaulted query can't be written back onto it — controllers must
    // read req.validatedQuery instead of req.query whenever their route validates a query schema.
    if (parsed.query !== undefined) req.validatedQuery = parsed.query;
    if (parsed.params !== undefined) Object.assign(req.params, parsed.params);

    next();
  };
};
