import { ContactConsent } from './outbound-message.service';

/**
 * Interim consent check until transporter / partner records carry whatsapp_opt_in_at (plan task 1;
 * open decision: where opt-in is captured). Allows every send and warns once, so the gap stays
 * visible.
 */
export function createInterimContactConsent(
  logger: { warn(message: string): void } = console,
): ContactConsent {
  let hasWarned = false;
  return {
    async hasWhatsappOptIn() {
      if (!hasWarned) {
        logger.warn(
          '[messaging] WhatsApp opt-in is not recorded for transporters/partners yet — sends are allowed (interim)',
        );
        hasWarned = true;
      }
      return true;
    },
  };
}
