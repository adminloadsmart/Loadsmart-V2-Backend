import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

/** An outside service we depend on (VAHAN via ULIP, Sarathi) couldn't be reached. Expected, so
 *  it isn't logged as a crash; `code` lets the client offer its fallback (e.g. VAHAN_UNAVAILABLE
 *  → "verify the truck manually"). */
export class ServiceUnavailableError extends AppError {
  constructor(message: string | MessageRef, code = 'SERVICE_UNAVAILABLE', details?: unknown) {
    super(message, 503, code, details);
  }
}
