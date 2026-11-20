import { AppError } from '../../../shared/errors/AppError';

/**
 * The resolution note for a business write a WhatsApp reply could not make. A rule it broke
 * ("Vehicle … is already on an active load") reads as is; an unexpected failure is wrapped by
 * `rethrow` as "Failed to …" with the real error only in `details` — that cause is kept on the
 * note and logged, or the inbound row says nothing useful (seen live 19 Nov on LOAD-1010).
 */
export function writeErrorNote(error: AppError, loadRef: string): string {
  const cause = error.details instanceof Error ? error.details : null;
  if (!cause) return error.message;
  console.error(`[messaging] WhatsApp reply write failed for ${loadRef}: ${error.message}`, cause);
  return `${error.message}: ${cause.message}`;
}
