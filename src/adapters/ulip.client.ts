import { env } from '../config/env';

/**
 * Result of a driving-licence lookup against the Sarathi registry, reached through ULIP (the
 * govt. Unified Logistics Interface Platform gateway). `manual_review` covers "registry says it
 * doesn't recognise this licence", "ULIP isn't configured", and "the call failed" — the caller
 * doesn't need to tell those apart, since all three fall back to the same manual-entry route.
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

// TODO(ulip): confirm the token lifetime ULIP actually returns; refreshing a little early avoids
// racing a token that expires mid-request.
const TOKEN_REFRESH_SKEW_MS = 30_000;

interface UlipLoginResponse {
  response: {
    AuthToken: string;
    TokenType: string;
    // ISO timestamp — TODO(ulip): confirm exact field name/format in the real login response.
    Expiration: string;
  };
}

interface UlipCovDetail {
  category: string;
  cov: string;
  issue_date: string;
}

/**
 * TODO(ulip): placeholder shape for the Sarathi DL record ULIP returns — confirm every field name
 * against the real `dlDetails` (or equivalent) response once ULIP's API docs/sandbox are available.
 * Modelled on IDfy's equivalent fields so `mapResult` below needs minimal changes once confirmed.
 */
interface UlipDrivingLicenceRecord {
  status: string; // e.g. 'id_found' | 'id_not_found'
  name: string | null;
  dl_status: string | null;
  nt_validity_to: string | null;
  t_validity_to: string | null;
  cov_details: UlipCovDetail[] | null;
  address: string | null;
  city: string | null;
  [key: string]: unknown;
}

interface UlipDataResponse {
  response: {
    code: number;
    message: UlipDrivingLicenceRecord[];
  };
}

/**
 * Wraps ULIP's Sarathi driving-licence lookup. ULIP fronts several government registries behind
 * one gateway: you log in once for a bearer token, then query a specific registry's dataset by its
 * "index" id. TODO(ulip): confirm the login endpoint, the data-query endpoint, the DL dataset index,
 * and the request/response field names against ULIP's actual API docs — everything below is a
 * best-effort placeholder carried over from the IDfy integration this replaces.
 */
export class UlipClient {
  private token: string | undefined;
  private tokenExpiresAt = 0;

  async lookupDrivingLicence(
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<SarathiDrivingLicenceResult> {
    if (!env.ulipBaseUrl || !env.ulipUsername || !env.ulipPassword || !env.ulipDlIndex) {
      return { status: 'manual_review' };
    }

    try {
      const token = await this.getToken();
      const record = await this.query(token, licenseNumber, dateOfBirth);
      return this.mapResult(record);
    } catch {
      // Network error, non-2xx, unexpected shape, or auth failure — all fall back to manual
      // review rather than surfacing a 500 to the "Add a driver" form.
      return { status: 'manual_review' };
    }
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    // TODO(ulip): confirm the login path and payload shape (username/password field names).
    const response = await fetch(`${env.ulipBaseUrl}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env.ulipUsername, password: env.ulipPassword }),
    });

    if (!response.ok) {
      throw new Error(`ULIP login failed with status ${response.status}`);
    }

    const body = (await response.json()) as UlipLoginResponse;
    this.token = body.response.AuthToken;
    this.tokenExpiresAt = Date.parse(body.response.Expiration) - TOKEN_REFRESH_SKEW_MS;
    return this.token;
  }

  private async query(
    token: string,
    licenseNumber: string,
    dateOfBirth: string,
  ): Promise<UlipDrivingLicenceRecord> {
    // TODO(ulip): confirm the data-query path, the `index` query param value for the Sarathi DL
    // dataset (env.ulipDlIndex), and the request body's field names.
    const response = await fetch(
      `${env.ulipBaseUrl}/data/eventData?index=${encodeURIComponent(env.ulipDlIndex!)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id_number: licenseNumber, date_of_birth: dateOfBirth }),
      },
    );

    if (!response.ok) {
      throw new Error(`ULIP data query failed with status ${response.status}`);
    }

    const body = (await response.json()) as UlipDataResponse;
    const [record] = body.response.message;
    if (!record) {
      throw new Error('ULIP data query returned no records');
    }
    return record;
  }

  private mapResult(record: UlipDrivingLicenceRecord): SarathiDrivingLicenceResult {
    if (record.status !== 'id_found') {
      return { status: 'manual_review', rawResponse: record };
    }

    return {
      status: 'verified',
      holderName: record.name ?? undefined,
      // Non-transport validity is the general driving-licence validity; transport (commercial) is
      // the fallback for drivers who only hold that class.
      validUntil: record.nt_validity_to ?? record.t_validity_to ?? undefined,
      licenseClass: record.cov_details?.map((cov) => cov.cov).join(', ') || undefined,
      licenseStatus: record.dl_status ?? undefined,
      addressLine1: record.address ?? undefined,
      city: record.city ?? undefined,
      rawResponse: record,
    };
  }
}
