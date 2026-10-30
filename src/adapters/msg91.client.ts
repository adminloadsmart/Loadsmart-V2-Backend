import { env } from '../config/env';
import { isMsg91SkippedNumber, toIndianMsisdn } from '../shared/utils/phone-number';

interface Msg91Response {
  type?: string; // 'success' | 'error'
  message?: string;
}

/** The WhatsApp API's answer — `status`/`hasError` like the Email API, not the SMS APIs' `type`.
 *  The rest (request id, `errors`) is passed back to the caller as-is. */
interface Msg91WhatsappResponse {
  status?: string; // 'success' | 'fail'
  hasError?: boolean;
  [key: string]: unknown;
}

/**
 * Every phone number goes out as 91XXXXXXXXXX (toIndianMsisdn) — Loadsmart only sends to Indian
 * numbers, and they're stored without the country code.
 *
 * Login/signup OTPs don't use MSG91's OTP API: OtpService sends them as a normal Flow SMS via
 * sendTransactional (MSG91_SMS_TEMPLATE_OTP) and verifies the code itself.
 *
 * sendTransactional/sendWhatsapp never reach a test number (isMsg91SkippedNumber) — they resolve
 * without calling MSG91. That includes the login/signup OTP SMS above.
 *
 * This class assumes real credentials are present and always calls MSG91 — the dev-only bypass
 * that skips MSG91 entirely (see auth.constants.ts's DEV_BYPASS_OTP / useDevOtpBypass) is handled
 * by OtpService, keeping this a pure MSG91 wrapper.
 */
export class Msg91Client {
  /**
   * Generic transactional/notification SMS via MSG91's Flow API — used by the notifications
   * module's SmsChannel and OtpService (login/signup OTP, with MSG91_SMS_TEMPLATE_OTP). Requires
   * a DLT-approved Flow template
   * (env.msg91NotificationTemplateId) to be provisioned on the MSG91 dashboard first; the exact
   * variable names it expects are template-defined, so `variables`' keys here (currently `title`/
   * `body`) are provisional until a real template exists to verify against.
   */
  async sendTransactional(
    phoneNumber: string,
    variables: Record<string, string>,
    templateId: string | undefined = env.msg91NotificationTemplateId,
  ): Promise<string | undefined> {
    if (isMsg91SkippedNumber(phoneNumber)) {
      console.info(`MSG91 SMS skipped for test number ${phoneNumber}`);
      return undefined;
    }
    if (!env.msg91AuthKey || !templateId) {
      throw new Error(
        'MSG91_AUTH_KEY / MSG91_NOTIFICATION_TEMPLATE_ID not configured — cannot send SMS',
      );
    }

    const response = await fetch(`${env.msg91BaseUrl}/api/v5/flow/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: env.msg91AuthKey },
      body: JSON.stringify({
        template_id: templateId,
        recipients: [{ mobiles: toIndianMsisdn(phoneNumber), ...variables }],
      }),
    });
    const body = (await response.json().catch(() => null)) as Msg91Response | null;

    if (body?.type !== 'success') {
      throw new Error(`MSG91 send SMS failed: ${body?.message ?? response.status}`);
    }
    // On success the Flow API's `message` is the request id (searchable in MSG91's SMS reports).
    return body.message;
  }

  /**
   * WhatsApp Business template message via MSG91's WhatsApp API — used by the notifications
   * module's WhatsappChannel. Unlike sendTransactional above, the message copy itself is never
   * composed here: WhatsApp Business requires every template pre-approved by Meta, so the actual
   * text lives on the MSG91/WhatsApp Business dashboard (env.msg91WhatsappTemplateName); this
   * method only forwards the caller's variables, in template placeholder order ({{var_1}},
   * {{var_2}}, ...), as that template's body components.
   *
   * Unlike sendTransactional above, this hits `env.msg91WhatsappBaseUrl`
   * (`api.msg91.com` by default), not `env.msg91BaseUrl` (`control.msg91.com`) — MSG91's WhatsApp
   * send API lives on a different host from the rest of their v5 API, confirmed against
   * https://msg91.com/help/whatsapp/send-whatsapp.
   */
  async sendWhatsapp(
    phoneNumber: string,
    variables: string[],
    templateName: string | undefined = env.msg91WhatsappTemplateName,
  ): Promise<Msg91WhatsappResponse | undefined> {
    if (isMsg91SkippedNumber(phoneNumber)) {
      console.info(`MSG91 WhatsApp skipped for test number ${phoneNumber}`);
      return undefined;
    }
    if (!env.msg91AuthKey || !env.msg91WhatsappIntegratedNumber || !templateName) {
      throw new Error(
        'MSG91_AUTH_KEY / MSG91_WHATSAPP_INTEGRATED_NUMBER / MSG91_WHATSAPP_TEMPLATE_NAME not configured — cannot send WhatsApp message',
      );
    }

    // Our templates use named variables ({{var_1}}, {{var_2}}...), which MSG91 expects as
    // `body_var_N` with a matching `parameter_name` — per the dashboard's Code (JSON) sample.
    const components = Object.fromEntries(
      variables.map((value, index) => [
        `body_var_${index + 1}`,
        { type: 'text', value, parameter_name: `var_${index + 1}` },
      ]),
    );

    const response = await fetch(
      `${env.msg91WhatsappBaseUrl}/api/v5/whatsapp/whatsapp-outbound-message/bulk/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: env.msg91AuthKey },
        body: JSON.stringify({
          integrated_number: env.msg91WhatsappIntegratedNumber,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'en', policy: 'deterministic' },
              namespace: env.msg91WhatsappNamespace,
              to_and_components: [{ to: [toIndianMsisdn(phoneNumber)], components }],
            },
          },
        }),
      },
    );
    // Like the Email API below, this endpoint answers with `status`/`hasError`, not the `type`
    // field the SMS/OTP APIs use. Checking `type` here rejected every accepted message, so BullMQ
    // retried it and the recipient got the same WhatsApp three times.
    const body = (await response.json().catch(() => null)) as Msg91WhatsappResponse | null;

    if (!response.ok || body?.hasError || body?.status !== 'success') {
      // The whole body, not just `message` — MSG91 often puts the actual reason under `errors`.
      throw new Error(
        `MSG91 send WhatsApp message failed (HTTP ${response.status}): ${body ? JSON.stringify(body) : 'no JSON body'}`,
      );
    }
    // Accepted is not delivered — Meta can still reject it afterwards (e.g. a template parameter
    // mismatch), which only shows in the MSG91 dashboard's WhatsApp reports. Returned so callers
    // can log MSG91's request id to search there.
    return body;
  }

  /**
   * Transactional email via MSG91's Email API — used by the notifications module's EmailChannel.
   * Same "template lives on the MSG91 dashboard" model as sendWhatsapp: the subject and body are
   * authored there (against a domain verified on the dashboard); this only forwards the
   * template's variables. Request/response shape per MSG91's v5 email/send API — the response
   * carries `status`/`hasError`, not the `type` field the SMS/OTP APIs use.
   */
  async sendEmail(
    to: { email: string; name?: string | null },
    variables: Record<string, string>,
    templateId: string | undefined,
  ): Promise<void> {
    if (!env.msg91AuthKey || !env.msg91EmailDomain || !env.msg91EmailFrom || !templateId) {
      throw new Error(
        'MSG91_AUTH_KEY / MSG91_EMAIL_DOMAIN / MSG91_EMAIL_FROM / email template id not configured — cannot send email',
      );
    }

    const response = await fetch(`${env.msg91BaseUrl}/api/v5/email/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        authkey: env.msg91AuthKey,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }],
            variables,
          },
        ],
        from: { email: env.msg91EmailFrom, name: env.msg91EmailFromName },
        // Only when configured — otherwise the request body is exactly as before.
        ...(env.msg91EmailReplyTo ? { reply_to: [{ email: env.msg91EmailReplyTo }] } : {}),
        domain: env.msg91EmailDomain,
        template_id: templateId,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      hasError?: boolean;
      message?: string;
    } | null;

    if (!response.ok || body?.hasError || body?.status !== 'success') {
      throw new Error(`MSG91 send email failed: ${body?.message ?? response.status}`);
    }
  }
}
