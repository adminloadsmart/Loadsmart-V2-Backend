import { Request, RequestHandler } from 'express';
import { Locale } from '../i18n/locales';
import { resolveLocale } from '../i18n/resolve-locale';

// Resolves the request language from the client's own signals only: `?lang=` first, then
// Accept-Language. A stored user/driver preference is layered on after authentication (PR 2);
// `localeSource` records which signal won so that step can decide whether it may override.
export const localeMiddleware: RequestHandler = (req, res, next) => {
  const { locale, source } = resolveLocale({
    query: req.query.lang,
    acceptLanguage: req.header('Accept-Language'),
  });

  req.locale = locale;
  req.localeSource = source;
  res.setHeader('Content-Language', locale);
  res.vary('Accept-Language');
  next();
};

// The language the client actually asked for, or null when it sent none — for saving a preference
// (e.g. a driver device's push language) without overwriting it with the English default.
export const requestedLocaleOf = (req: Request): Locale | null =>
  req.localeSource === 'default' ? null : req.locale;
