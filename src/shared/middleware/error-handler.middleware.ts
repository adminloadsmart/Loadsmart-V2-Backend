import { ErrorRequestHandler } from 'express';
import { AppError } from '../errors';
import { DEFAULT_LOCALE } from '../i18n/locales';
import { t } from '../i18n/translate';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // req.locale is unset for errors raised before locale.middleware runs (a CORS rejection or a
  // malformed JSON body both fire ahead of it in app.ts), so fall back rather than assume it.
  const locale = req.locale ?? DEFAULT_LOCALE;

  if (err instanceof AppError) {
    if (!err.isOperational) {
      console.error(err);
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        // Services never see the locale: they throw a key (or legacy English text) and the
        // translation happens here, once, using the request's resolved language.
        message: err.messageKey ? t(locale, err.messageKey, err.params) : err.message,
        // `isOperational` already distinguishes "expected error, details are safe to show" from
        // "unexpected failure" — InternalError sets it false and its `details` is whatever raw
        // error rethrow() caught (a TypeORM QueryFailedError carries the literal failing SQL and
        // its bound parameters as own properties), which must never reach the client.
        ...(err.isOperational ? { details: err.details } : {}),
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: t(locale, 'errors.internal') },
  });
};
