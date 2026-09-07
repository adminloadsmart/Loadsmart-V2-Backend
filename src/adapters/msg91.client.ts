import { env } from '../config/env';

interface Msg91Response {
  type?: string; // 'success' | 'error'
  message?: string;
}

/**
 * Wraps MSG91's OTP API (`/api/v5/otp` + `/api/v5/otp/verify`) — unlike a generic SMS gateway,
 * MSG91 both generates the OTP and verifies it: we never see or store the code ourselves.
 * `sendOtp` requires a DLT-approved `template_id` to be configured on the MSG91 dashboard first;
 * without one, delivery fails regardless of code correctness.
 *
 * This class assumes real credentials are present and always calls MSG91 — the dev-only bypass
 * that skips MSG91 entirely (see auth.constants.ts's DEV_BYPASS_OTP / useDevOtpBypass) is handled
 * by the callers in auth.service.ts, keeping this a pure MSG91 wrapper.
 */
export class Msg91Client {
  async sendOtp(phoneNumber: string): Promise<void> {
    const url = new URL(`${env.msg91BaseUrl}/api/v5/otp`);
    url.searchParams.set('template_id', env.msg91TemplateId!);
    url.searchParams.set('mobile', phoneNumber);
    url.searchParams.set('authkey', env.msg91AuthKey!);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = (await response.json().catch(() => null)) as Msg91Response | null;

    if (body?.type !== 'success') {
      throw new Error(`MSG91 send OTP failed: ${body?.message ?? response.status}`);
    }
  }

  /** Returns false for a genuine "wrong/expired code" response — MSG91's normal way of saying
   *  no match, not a failure. Throws only on transport/unexpected-shape failures, so callers can
   *  tell "wrong code" apart from "MSG91 is down". */
  async verifyOtp(phoneNumber: string, otp: string): Promise<boolean> {
    const url = new URL(`${env.msg91BaseUrl}/api/v5/otp/verify`);
    url.searchParams.set('otp', otp);
    url.searchParams.set('mobile', phoneNumber);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { authkey: env.msg91AuthKey! },
    });
    const body = (await response.json().catch(() => null)) as Msg91Response | null;

    if (body?.type === 'success') return true;
    if (body?.type === 'error') return false;
    throw new Error(`MSG91 verify OTP failed: ${response.status}`);
  }

  /**
   * Generic transactional/notification SMS via MSG91's Flow API — used by the notifications
   * module's SmsChannel, distinct from sendOtp above (which hits MSG91's dedicated,
   * auto-generating OTP API instead). Requires a separate DLT-approved Flow template
   * (env.msg91NotificationTemplateId) to be provisioned on the MSG91 dashboard first; the exact
   * variable names it expects are template-defined, so `variables`' keys here (currently `title`/
   * `body`) are provisional until a real template exists to verify against.
   */
  async sendTransactional(phoneNumber: string, variables: Record<string, string>): Promise<void> {
    if (!env.msg91AuthKey || !env.msg91NotificationTemplateId) {
      throw new Error(
        'MSG91_AUTH_KEY / MSG91_NOTIFICATION_TEMPLATE_ID not configured — cannot send SMS',
      );
    }

    const response = await fetch(`${env.msg91BaseUrl}/api/v5/flow/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: env.msg91AuthKey },
      body: JSON.stringify({
        template_id: env.msg91NotificationTemplateId,
        recipients: [{ mobiles: phoneNumber, ...variables }],
      }),
    });
    const body = (await response.json().catch(() => null)) as Msg91Response | null;

    if (body?.type !== 'success') {
      throw new Error(`MSG91 send SMS failed: ${body?.message ?? response.status}`);
    }
  }
}
