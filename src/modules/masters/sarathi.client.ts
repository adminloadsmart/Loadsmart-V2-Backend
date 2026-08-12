import { env } from '../../config/env';

/**
 * Result of a driving-licence lookup against the Sarathi registry. `manual_review` covers both
 * "registry says it doesn't recognise this licence" and "we couldn't reach the registry at all" —
 * the caller doesn't need to tell those apart, since both fall back to the same manual-entry route.
 */
export interface SarathiDrivingLicenceResult {
  status: 'verified' | 'manual_review';
  holderName?: string;
  validUntil?: string;
  licenseClass?: string;
  licenseStatus?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  rawResponse?: Record<string, unknown>;
}

/**
 * Thin wrapper around the government Sarathi DL registry. No API key has been provisioned yet, so
 * every lookup falls back to manual_review; once SARATHI_API_KEY/SARATHI_BASE_URL are set, only the
 * body of this method needs to change to the real HTTP call — callers already handle both outcomes.
 */
export class SarathiClient {
  async lookupDrivingLicence(_licenseNumber: string): Promise<SarathiDrivingLicenceResult> {
    if (!env.sarathiApiKey || !env.sarathiBaseUrl) {
      return { status: 'manual_review' };
    }

    // TODO: call the real Sarathi API once credentials are configured.
    return { status: 'manual_review' };
  }
}
