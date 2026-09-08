import { env } from '../config/env';

/** Result of a driving-licence lookup against the SARATHI registry, via ULIP. */
export interface UlipDrivingLicenceResult {
  status: 'verified' | 'not_found' | 'manual_review';
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

/** Compliance-paper expiry dates VAHAN returns alongside the vehicle record, all as ISO dates. */
export interface UlipVehiclePapers {
  insuranceValidTo?: string;
  rcValidTo?: string;
  permitValidTo?: string;
  pucValidTo?: string;
  fitnessValidTo?: string;
}

/** Result of a vehicle lookup against the VAHAN registry, via ULIP. */
export interface UlipVehicleResult {
  status: 'verified' | 'not_found' | 'manual_review';
  registeredName?: string;
  registeredOn?: string;
  vehicleClass?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  pinCode?: string;
  papers?: UlipVehiclePapers;
  rawResponse?: Record<string, unknown>;
}

/** VAHAN dates come back as "06-Dec-2018" — converts to the "2018-12-06" isoDate shape the
 * backend's verification schema expects. Returns undefined on anything that doesn't match. */
const VAHAN_MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function parseVahanDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (!match) return undefined;
  const [, day, mon, year] = match;
  const month = VAHAN_MONTHS[mon];
  return month ? `${year}-${month}-${day}` : undefined;
}

type JsonRecord = Record<string, unknown>;

/**
 * Every ULIP source call (SARATHI, VAHAN, ...) shares this gateway envelope — confirmed against
 * real `/SARATHI/01` and `/VAHAN/04` staging responses: `error`/`code` describe whether the
 * gateway call itself completed; `response` carries one result per queried source, each with its
 * own `responseStatus`. What differs per source is what's *inside* that per-source `response` —
 * see mapDrivingLicenceResult/mapVehicleResult's own doc comments.
 */
interface UlipEnvelope {
  response: UlipSourceResult[] | null;
  error: string; // "true" | "false" — a string, not a boolean
  code: string; // "200" once the gateway call itself completed
  message: string | null;
}

interface UlipSourceResult {
  response: JsonRecord | null;
  responseStatus: string; // "SUCCESS" observed; other values presumed possible
  message: string | null;
}

/** `/user/login`'s envelope — same `error`/`code`/`message` wrapper, but `response` is a single
 * object (`{ id, params, text }`) rather than an array of per-source results. Confirmed 2026-08. */
interface UlipLoginEnvelope {
  response: { id: string | null; params: unknown; text: unknown } | null;
  error: string;
  code: string;
  message: string | null;
}

/**
 * Wraps ULIP (DPIIT's Unified Logistics Interface Platform) staging APIs: `/user/login` for a
 * bearer token, then `/SARATHI/01` (driving-licence lookup) and `/VAHAN/04` (vehicle lookup — the
 * account's staging grant moved from VAHAN/01 to VAHAN/04, same request/response shape), both
 * against the same staging host per this account's ULIP setup. The token is cached in memory and
 * reused across calls; a 401 triggers exactly one re-login-and-retry, since ULIP's login response
 * doesn't document a token TTL to pre-empt expiry with.
 *
 * `mapDrivingLicenceResult`'s SARATHI shape is confirmed against real staging responses for BOTH
 * outcomes (a matching and a non-matching dlnumber). `mapVehicleResult`'s VAHAN shape is confirmed
 * only for a match — no not-found VAHAN response has been seen yet, so that path is still a
 * conservative best-effort fallback (empty/missing response data). See each method's own doc
 * comment for the masked-PII caveats specific to it. Every raw payload is kept in `rawResponse`
 * regardless, so a `manual_review`/`not_found` result never loses the underlying data.
 */
export class UlipClient {
  private token: string | null = null;

  async verifyDrivingLicence(
    dlNumber: string,
    dateOfBirth: string,
  ): Promise<UlipDrivingLicenceResult> {
    console.log('ULIP SARATHI lookup', { dlNumber, dateOfBirth });
    if (!env.ulipUsername || !env.ulipPassword) {
      console.warn('ULIP SARATHI lookup skipped: missing credentials');
      return { status: 'manual_review' };
    }

    try {
      const body = await this.call('/SARATHI/01', { dlnumber: dlNumber, dob: dateOfBirth });
      console.log('ULIP SARATHI lookup response', body);
      return this.mapDrivingLicenceResult(body);
    } catch (error) {
      // Never throw to the caller — a broken/unreachable ULIP shouldn't block onboarding — but log
      // the real cause, since the response the caller sees is deliberately just `manual_review`
      // with no detail (login failure, network error, and a bad request all look identical here
      // otherwise, which makes this unit untestable from the outside).
      console.error('ULIP SARATHI lookup failed', error);
      return { status: 'manual_review' };
    }
  }

  async verifyVehicle(vehicleNumber: string): Promise<UlipVehicleResult> {
    if (!env.ulipUsername || !env.ulipPassword) {
      return { status: 'manual_review' };
    }

    try {
      // VAHAN/01 was the account's original grant; staging access was later switched to VAHAN/04
      // (2026-09), same request/response shape.
      const body = await this.call('/VAHAN/04', { vehiclenumber: vehicleNumber });
      return this.mapVehicleResult(body);
    } catch (error) {
      console.error('ULIP VAHAN lookup failed', error);
      return { status: 'manual_review' };
    }
  }

  /** POSTs an already-authenticated request, retrying once after a fresh login on a 401. */
  private async call(path: string, data: JsonRecord): Promise<JsonRecord> {
    const token = await this.getToken();
    const response = await this.post(path, data, token);

    if (response.status === 401) {
      const freshToken = await this.login();
      return this.readJson(await this.post(path, data, freshToken));
    }

    return this.readJson(response);
  }

  private async post(path: string, data: JsonRecord, token: string): Promise<Response> {
    return fetch(`${env.ulipBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
  }

  private async readJson(response: Response): Promise<JsonRecord> {
    if (!response.ok) {
      throw new Error(`ULIP request failed with status ${response.status}`);
    }

    const body = (await response.json()) as UlipEnvelope;
    // Gateway-level failure (bad request, source unavailable, ...) — distinct from a successful
    // call that simply found no record, which is handled per-endpoint in mapDrivingLicenceResult/
    // mapVehicleResult below.
    if (body.error === 'true' || body.code !== '200') {
      throw new Error(`ULIP gateway reported an error (code ${body.code})`);
    }
    return body as unknown as JsonRecord;
  }

  private async getToken(): Promise<string> {
    return this.token ?? (await this.login());
  }

  private async login(): Promise<string> {
    const response = await fetch(`${env.ulipBaseUrl}/user/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ username: env.ulipUsername, password: env.ulipPassword }),
    });
    console.log('ULIP login response', response);
    if (!response.ok) {
      // Include the body on failure — a 400 here is ULIP rejecting the request itself (bad
      // credentials, malformed payload, ...), and the response text usually says which; a bare
      // status code alone isn't enough to tell those apart from the server logs.
      const text = await response.text().catch(() => '');
      throw new Error(`ULIP login failed with status ${response.status}: ${text}`);
    }

    const body = (await response.json()) as UlipLoginEnvelope;
    if (body.error === 'true' || body.code !== '200') {
      throw new Error(`ULIP login reported an error (code ${body.code})`);
    }

    // Confirmed shape (2026-08 staging test): the token is `response.id`, not `response.token` —
    // `id` here means "the issued credential", not a record identifier.
    const token = body.response?.id ?? undefined;
    if (!token) {
      throw new Error('ULIP login response did not include a token');
    }

    this.token = token;
    console.log('ULIP login token', token);
    return token;
  }

  /**
   * Confirmed shape (2026-08/09 staging tests, both a not-found and a matched DL):
   * `response[0].response.dldetobj[0]` is the per-record detail — `errorcd: -1` / `dlobj: null`
   * when nothing matched, `errorcd: 0` with `dlobj`/`dlcovs`/`bioObj` populated on a match.
   *
   * `bioObj` (biometric/KYC data) partially masks PII: on a real matched record, `bioFullName` and
   * `bioPermAdd1`/`2`/`3` came back like `"M*H*S*K*M*R* *O*I*"` — alternating characters replaced
   * with `*` — so holder name and address are deliberately NOT surfaced here; the caller's existing
   * "registry didn't return this field" manual-entry fallback handles it the same as an omission.
   * `bioPermSdName`/`bioPermPin` are NOT masked in that same response (confirmed: `bioPermDistName`
   * came back masked as `"B*t*d"` while `bioPermSdName` had the identical place name, "Botad",
   * fully unmasked) — masking is per-field, not content-sensitive, so those two are safe to use as
   * city/pinCode.
   */
  private mapDrivingLicenceResult(body: JsonRecord): UlipDrivingLicenceResult {
    console.log('ULIP SARATHI lookup response', body);
    const detail = this.firstSourceDetail(body, 'dldetobj');
    const data = detail?.dlobj as JsonRecord | null | undefined;
    console.log('ULIP SARATHI lookup detail', { detail, data });
    if (!detail || detail.errorcd === -1 || !data) {
      return { status: 'not_found', rawResponse: body };
    }

    const bio = detail.bioObj as JsonRecord | null | undefined;
    const covs = (detail.dlcovs as JsonRecord[] | null | undefined) ?? [];
    const licenseClass = covs
      .map((cov) => (typeof cov.covabbrv === 'string' ? cov.covabbrv.trim() : null))
      .filter((value): value is string => Boolean(value))
      .join(', ');

    return {
      status: 'verified',
      validUntil: this.pickString(data, ['dlNtValdtoDt', 'dlTrValdtoDt']),
      licenseClass: licenseClass || undefined,
      licenseStatus: this.pickString(data, ['dlStatus']),
      city: bio ? this.pickString(bio, ['bioPermSdName']) : undefined,
      pinCode: bio ? this.pickString(bio, ['bioPermPin']) : undefined,
      rawResponse: body,
    };
  }

  /**
   * Confirmed shape (2026-09 staging test, a matched vehicle on `/VAHAN/04`): unlike SARATHI,
   * VAHAN does NOT nest a detail array — `response[0].response` is the flat RC record directly,
   * with `rc`-prefixed field names (`rcOwnerName`, `rcRegnDt`, `rcVhClassDesc`, ...). No not-found
   * sample has been seen yet, so that path still just falls back on an empty/missing response.
   *
   * `rcOwnerName` came back masked ("L***I D**I") — same per-field PII masking SARATHI applies to
   * `bioFullName` — so it's deliberately not surfaced, consistent with mapDrivingLicenceResult.
   * `rcPermanentAddress`/`rcPresentAddress` are NOT masked, but only carry "City, PINCODE"
   * granularity (no street line) — split into city/pinCode rather than surfaced as an address line.
   *
   * Also carries the compliance-paper dates (insurance/RC/PUC/fitness validity) VAHAN returns
   * alongside the vehicle record — this is what the "Add a vehicle" form's Papers section is meant
   * to auto-fill from a VAHAN hit, per its existing UI copy.
   */
  private mapVehicleResult(body: JsonRecord): UlipVehicleResult {
    console.log('ULIP VAHAN lookup response', body);
    const data = this.firstSourceResponse(body);
    if (!data || Object.keys(data).length === 0) {
      console.log('ULIP VAHAN lookup detail', { data });
      return { status: 'not_found', rawResponse: body };
    }

    const { city, pinCode } = this.splitCityPin(
      this.pickString(data, ['rcPermanentAddress', 'rcPresentAddress']),
    );

    return {
      status: 'verified',
      registeredOn: parseVahanDate(this.pickString(data, ['rcRegnDt'])),
      vehicleClass: this.pickString(data, ['rcVhClassDesc', 'rcVchCatgDesc']),
      city,
      pinCode,
      papers: {
        insuranceValidTo: parseVahanDate(this.pickString(data, ['rcInsuranceUpto'])),
        rcValidTo: parseVahanDate(this.pickString(data, ['rcRegnUpto'])),
        permitValidTo: parseVahanDate(this.pickString(data, ['rcPermitValidUpto'])),
        pucValidTo: parseVahanDate(this.pickString(data, ['rcPuccUpto'])),
        fitnessValidTo: parseVahanDate(this.pickString(data, ['rcFitUpto', 'rcFitValidTo'])),
      },
      rawResponse: body,
    };
  }

  /** VAHAN's address fields are "City, PINCODE" strings (e.g. "Lucknow, 226001") with no street
   * line — splits the trailing 6-digit PIN off, treating whatever's left as the city. */
  private splitCityPin(value: string | undefined): { city?: string; pinCode?: string } {
    if (!value) return {};
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return {};

    const last = parts[parts.length - 1];
    if (/^\d{6}$/.test(last)) {
      return { city: parts.length >= 2 ? parts[parts.length - 2] : undefined, pinCode: last };
    }
    return { city: parts.join(', ') };
  }

  /** `body.response[0].response` — the first (and, per calls made here, only) queried source's result. */
  private firstSourceResponse(body: JsonRecord): JsonRecord | null {
    const items = body.response;
    if (!Array.isArray(items) || items.length === 0) return null;
    const first = items[0] as JsonRecord | undefined;
    return (first?.response as JsonRecord | undefined) ?? null;
  }

  /** `body.response[0].response.<detailArrayKey>[0]` — see mapDrivingLicenceResult's doc comment. */
  private firstSourceDetail(body: JsonRecord, detailArrayKey: string): JsonRecord | null {
    const inner = this.firstSourceResponse(body);
    const detailArray = inner?.[detailArrayKey];
    if (!Array.isArray(detailArray) || detailArray.length === 0) return null;
    return (detailArray[0] as JsonRecord) ?? null;
  }

  private pickString(data: JsonRecord, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }
}
