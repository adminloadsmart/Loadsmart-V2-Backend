import { env } from '../config/env';

/**
 * Result of a VAHAN lookup through ULIP. Shaped after vehicle.validators.ts's
 * vehicleVerificationBody so the client can hand it straight to /vehicles/onboard or
 * /vehicles/:vehicleId/verifications. Every registry field is optional — VAHAN leaves many blank
 * for older registrations — and `rawResponse` is always included so the mapping can be checked
 * against what ULIP actually returned.
 */
export interface UlipVahanResult {
  status: 'verified' | 'not_found';
  registrationNumber: string;
  registeredName?: string;
  registeredOn?: string;
  vehicleClass?: string;
  makerModel?: string;
  fuelType?: string;
  chassisNumber?: string;
  engineNumber?: string;
  registeringAuthority?: string;
  financierName?: string;
  addressLine1?: string;
  papers: {
    insuranceValidTo?: string;
    rcValidTo?: string;
    permitValidTo?: string;
    pucValidTo?: string;
    fitnessValidTo?: string;
    roadTaxValidTo?: string;
    insuranceProvider?: string;
  };
  rawResponse?: unknown;
}

/** Thrown for every failed ULIP call — the service maps `code` to an AppError. */
export class UlipError extends Error {
  constructor(
    public readonly code:
      'NOT_CONFIGURED' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'UPSTREAM_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'UlipError';
  }
}

/** ULIP wraps every response in this envelope; `response` is the API-specific payload. */
interface UlipEnvelope<T> {
  error?: string; // 'true' | 'false'
  code?: string;
  message?: string;
  response?: T;
}

interface UlipLoginPayload {
  id?: string;
  token?: string;
}

interface UlipVahanItem {
  response?: unknown;
  responseStatus?: string;
}

// ~15s ceiling, same budget as SarathiClient.
const REQUEST_TIMEOUT_MS = 15_000;
// Refresh the token this long before its `exp` so an in-flight call never carries a stale one.
const TOKEN_EXPIRY_SKEW_MS = 60_000;
// Used when the token isn't a decodable JWT with an `exp` claim.
const FALLBACK_TOKEN_TTL_MS = 25 * 60_000;

/**
 * Wraps ULIP's (DPIIT's Unified Logistics Interface Platform) VAHAN vehicle-registration lookup.
 * Every API call needs a bearer token from POST /user/login; the token is cached in memory and
 * reused until shortly before it expires, and concurrent callers share one in-flight login. A
 * 401/403 from VAHAN drops the cached token and retries once with a fresh login. ULIP only
 * accepts calls from whitelisted server IPs, so this only works from a deployed environment.
 */
export class UlipClient {
  private token?: { value: string; expiresAt: number };
  private loginInFlight?: Promise<string>;

  async lookupVehicle(vehicleNumber: string): Promise<UlipVahanResult> {
    if (!env.ulipUsername || !env.ulipPassword) {
      throw new UlipError('NOT_CONFIGURED', 'ULIP_USERNAME/ULIP_PASSWORD not configured');
    }

    let response = await this.postVahan(vehicleNumber, await this.getToken());
    if (response.status === 401 || response.status === 403) {
      // TODO(ulip-debug): remove once verified on the server.
      console.log(`[ULIP DEBUG] VAHAN/04 rejected the token (${response.status}) — re-logging in`);
      this.token = undefined;
      response = await this.postVahan(vehicleNumber, await this.getToken());
    }

    const { body, text } = await readBody<UlipEnvelope<UlipVahanItem[]>>(response);
    // TODO(ulip-debug): remove once verified on the server.
    console.log(`[ULIP DEBUG] VAHAN/04 response status=${response.status} body=${text}`);

    if (!response.ok || !body || body.error === 'true') {
      throw new UlipError(
        'UPSTREAM_ERROR',
        `ULIP VAHAN/04 failed with status ${response.status}: ${failureReason(body, text)}`,
      );
    }

    return this.mapResult(vehicleNumber, body);
  }

  private postVahan(vehicleNumber: string, token: string): Promise<Response> {
    // TODO(ulip-debug): remove once verified on the server — prints a live bearer token.
    console.log(
      `[ULIP DEBUG] VAHAN/04 request url=${env.ulipBaseUrl}/VAHAN/04 ` +
        `vehiclenumber=${vehicleNumber} Authorization="Bearer ${token}"`,
    );
    return this.request('/VAHAN/04', { vehiclenumber: vehicleNumber }, token);
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) {
      // TODO(ulip-debug): remove once verified on the server.
      console.log(
        `[ULIP DEBUG] using cached token (expires ${new Date(this.token.expiresAt).toISOString()})`,
      );
      return this.token.value;
    }
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = undefined;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
    // TODO(ulip-debug): remove once verified on the server. The password itself is never logged.
    console.log(
      `[ULIP DEBUG] login request url=${env.ulipBaseUrl}/user/login ` +
        `username=${env.ulipUsername} passwordSet=${Boolean(env.ulipPassword)} ` +
        `passwordLength=${env.ulipPassword?.length ?? 0}`,
    );
    const response = await this.request('/user/login', {
      username: env.ulipUsername,
      password: env.ulipPassword,
    });
    const { body, text } = await readBody<UlipEnvelope<UlipLoginPayload> & { token?: string }>(
      response,
    );
    // TODO(ulip-debug): remove once verified on the server — the body carries the token.
    console.log(`[ULIP DEBUG] login response status=${response.status} body=${text}`);
    const value = body?.response?.id ?? body?.response?.token ?? body?.token;

    if (!response.ok || !value) {
      throw new UlipError(
        'AUTH_FAILED',
        `ULIP login failed with status ${response.status}: ${failureReason(body, text)}`,
      );
    }

    this.token = { value, expiresAt: tokenExpiry(value) };
    return value;
  }

  private async request(path: string, payload: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      return await fetch(`${env.ulipBaseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new UlipError('TIMEOUT', `ULIP ${path} timed out`);
      }
      throw new UlipError('NETWORK_ERROR', `ULIP ${path} request failed: ${String(err)}`);
    }
  }

  private mapResult(vehicleNumber: string, body: UlipEnvelope<UlipVahanItem[]>): UlipVahanResult {
    const item = body.response?.[0];
    const record = parseRecord(item?.response);

    if (!record || item?.responseStatus?.toUpperCase() === 'FAILURE') {
      return {
        status: 'not_found',
        registrationNumber: vehicleNumber,
        papers: {},
        rawResponse: body,
      };
    }

    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() && value.trim().toUpperCase() !== 'NA') {
          return value.trim();
        }
        if (typeof value === 'number') return String(value);
      }
      return undefined;
    };
    const date = (...keys: string[]) => toIsoDate(pick(...keys));

    return {
      status: 'verified',
      registrationNumber: pick('rc_regn_no') ?? vehicleNumber,
      registeredName: pick('rc_owner_name'),
      registeredOn: date('rc_regn_dt'),
      vehicleClass: pick('rc_vh_class_desc', 'rc_vch_catg'),
      makerModel: pick('rc_maker_model'),
      fuelType: pick('rc_fuel_desc'),
      chassisNumber: pick('rc_chasi_no'),
      engineNumber: pick('rc_eng_no'),
      registeringAuthority: pick('rc_registered_at', 'rc_off_cd'),
      financierName: pick('rc_financer'),
      addressLine1: pick('rc_permanent_address', 'rc_present_address'),
      papers: {
        insuranceValidTo: date('rc_insurance_upto'),
        rcValidTo: date('rc_regn_upto'),
        permitValidTo: date('rc_permit_valid_upto', 'rc_np_upto'),
        pucValidTo: date('rc_pucc_upto'),
        fitnessValidTo: date('rc_fit_upto'),
        roadTaxValidTo: date('rc_tax_upto'),
        insuranceProvider: pick('rc_insurance_comp'),
      },
      rawResponse: body,
    };
  }
}

/** Reads the body as text first so a non-JSON error page (gateway/WAF) isn't lost, then parses it. */
async function readBody<T>(response: Response): Promise<{ body: T | null; text: string }> {
  const text = await response.text().catch(() => '');
  try {
    return { body: JSON.parse(text) as T, text };
  } catch {
    return { body: null, text };
  }
}

/** ULIP's own reason for a failure — never contains the request payload, so safe to log. */
function failureReason(body: UlipEnvelope<unknown> | null, text: string): string {
  const reason = body?.message || (body?.error !== 'true' && body?.error) || body?.code;
  return reason ? String(reason) : text.slice(0, 500) || 'empty response';
}

/** VAHAN's payload arrives either as an object or as a JSON string; anything else (an XML string
 *  from an older VAHAN API version, or empty) yields null and is surfaced via rawResponse only. */
function parseRecord(payload: unknown): Record<string, unknown> | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === 'string' && payload.trim().startsWith('{')) {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** VAHAN dates come as e.g. "15-Mar-2019", "15/03/2019" or ISO; normalised to YYYY-MM-DD. */
function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const match = value.match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})$/);
  if (!match) return undefined;

  const [, day, rawMonth, year] = match;
  const month = /^\d+$/.test(rawMonth)
    ? Number(rawMonth)
    : months.indexOf(rawMonth.toUpperCase()) + 1;
  if (month < 1 || month > 12) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Reads the JWT `exp` claim without verifying it — we only need to know when to re-login. */
function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp === 'number') return payload.exp * 1000 - TOKEN_EXPIRY_SKEW_MS;
  } catch {
    // Not a decodable JWT — fall through to the fixed TTL.
  }
  return Date.now() + FALLBACK_TOKEN_TTL_MS;
}
