import { env } from '../../../config/env';

/** The web app's full URL for an app path (e.g. `/loads/<id>`) — what an email's `cta_url` button
 *  opens. Empty when there's no path or FRONTEND_BASE_URL isn't set, so a template using
 *  `{{cta_url}}` still renders. */
export function appUrl(path: string | null): string {
  if (!path || !env.frontendBaseUrl) return '';
  return `${env.frontendBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
