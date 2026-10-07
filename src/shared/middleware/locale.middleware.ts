import { RequestHandler } from 'express';
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
