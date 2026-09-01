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
  rawResponse?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

/**
 * Every ULIP source call (SARATHI, VAHAN, ...) shares this gateway envelope — confirmed against a
 * real `/SARATHI/01` staging response (2026-08): `error`/`code` describe whether the gateway call
 * itself completed; `response` carries one result per queried source, each with its own
 * `responseStatus`. VAHAN is assumed to share this same outer shape (both are ULIP source
 * adapters on the same gateway) but that assumption is unverified — confirm against a real
 * `/VAHAN/01` response and adjust `mapVehicleResult` if it differs.
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
 * bearer token, then `/SARATHI/01` (driving-licence lookup) and `/VAHAN/01` (vehicle lookup),
 * both against the same staging host per this account's ULIP setup. The token is cached in memory
 * and reused across calls; a 401 triggers exactly one re-login-and-retry, since ULIP's login
 * response doesn't document a token TTL to pre-empt expiry with.
 *
 * `mapDrivingLicenceResult`'s SARATHI envelope/not-found detection is confirmed against a real
 * staging response; the exact field names inside a *found* `dlobj` are still a best-effort guess
 * (only a not-found sample has been seen). `mapVehicleResult`'s VAHAN shape is entirely unverified.
 * Every raw payload is kept in `rawResponse` regardless, so a `manual_review`/`not_found` fallback
 * never loses the underlying data — tighten the field extraction once real "found" samples for
 * both are seen.
 */
export class UlipClient {
  private token: string | null = null;

  async verifyDrivingLicence(
    dlNumber: string,
    dateOfBirth: string,
  ): Promise<UlipDrivingLicenceResult> {
    if (!env.ulipUsername || !env.ulipPassword) {
      return { status: 'manual_review' };
    }

    try {
      const body = await this.call('/SARATHI/01', { dlnumber: dlNumber, dob: dateOfBirth });
      return this.mapDrivingLicenceResult(body);
    } catch {
      return { status: 'manual_review' };
    }
  }

  async verifyVehicle(vehicleNumber: string): Promise<UlipVehicleResult> {
    if (!env.ulipUsername || !env.ulipPassword) {
      return { status: 'manual_review' };
    }

    try {
      const body = await this.call('/VAHAN/01', { vehiclenumber: vehicleNumber });
      return this.mapVehicleResult(body);
    } catch {
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: env.ulipUsername, password: env.ulipPassword }),
    });

    if (!response.ok) {
      throw new Error(`ULIP login failed with status ${response.status}`);
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
    return token;
  }

  /**
   * Confirmed shape (2026-08 staging test, a not-found DL): `response[0].response.dldetobj[0]` is
   * the per-record detail, with `errorcd: -1` / `erormsg: "Details not available "` and every other
   * field null when nothing matched. On a match, `errorcd` is presumed 0 and `dlobj` presumed to
   * hold the actual registry fields — unverified, since only a not-found sample has been seen.
   */
  private mapDrivingLicenceResult(body: JsonRecord): UlipDrivingLicenceResult {
    const detail = this.firstSourceDetail(body, 'dldetobj');
    const data = detail?.dlobj as JsonRecord | null | undefined;

    if (!detail || detail.errorcd === -1 || !data) {
      return { status: 'not_found', rawResponse: body };
    }

    return {
      status: 'verified',
      holderName: this.pickString(data, ['name', 'holderName', 'holder_name', 'driverName']),
      validUntil: this.pickString(data, [
        'ntValidityTo',
        'nt_validity_to',
        'tValidityTo',
        't_validity_to',
        'validUpto',
        'validity',
      ]),
      licenseClass: this.pickString(data, ['cov', 'class', 'vehicleClass', 'licenseClass']),
      licenseStatus: this.pickString(data, ['dlStatus', 'dl_status', 'status']),
      addressLine1: this.pickString(data, ['address', 'permanentAddress', 'addressLine1']),
      city: this.pickString(data, ['city']),
      pinCode: this.pickString(data, ['pinCode', 'pin_code', 'pincode']),
      rawResponse: body,
    };
  }

  /**
   * VAHAN's exact shape is unverified — no real response has been seen for it yet. Assumes only
   * the outer gateway envelope confirmed for SARATHI above (`response[0].response`); unlike
   * `mapDrivingLicenceResult`, this does NOT assume a nested `*detobj[0].*obj` layer, since that
   * part of SARATHI's shape hasn't been confirmed to generalize. Revisit once a real VAHAN response
   * is captured — it likely nests similarly (e.g. an `rcdetobj`/`rcobj` pair).
   */
  private mapVehicleResult(body: JsonRecord): UlipVehicleResult {
    const data = this.firstSourceResponse(body);
    if (!data || Object.keys(data).length === 0) {
      return { status: 'not_found', rawResponse: body };
    }

    return {
      status: 'verified',
      registeredName: this.pickString(data, ['ownerName', 'owner_name', 'registeredName', 'name']),
      registeredOn: this.pickString(data, ['regDate', 'reg_date', 'registrationDate']),
      vehicleClass: this.pickString(data, ['vehicleClass', 'vh_class_desc', 'class']),
      addressLine1: this.pickString(data, ['permanentAddress', 'permanent_address', 'address']),
      city: this.pickString(data, ['city']),
      pinCode: this.pickString(data, ['pinCode', 'pin_code', 'pincode']),
      rawResponse: body,
    };
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
