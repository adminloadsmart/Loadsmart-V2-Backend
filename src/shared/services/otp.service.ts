import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { RateLimitError, AuthenticationError, rethrow } from '../errors';
import { env } from '../../config/env';
import { normalizePhoneNumber } from '../utils/phone-number';
import { redisManager } from '../../db/redis';
import { Msg91Client } from '../../adapters/msg91.client';
import { MessageRef, msg } from '../i18n/translate';
import {
  MAX_OTP_ATTEMPTS,
  DEV_BYPASS_OTP,
  useDevOtpBypass,
} from '../../modules/auth/auth.constants';

/** How long a sent code stays valid — matches the OTP SMS text ("valid for 10 minutes"). */
const OTP_CODE_TTL_SECONDS = 10 * 60;

/** Phone-number OTP primitive shared by every OTP-based login flow in this codebase (staff
 *  signup/login in modules/auth/auth.service.ts, driver login in
 *  modules/driver/driver-auth.service.ts) — Redis-backed cooldown/attempt tracking, the code
 *  itself (sent as a normal MSG91 Flow SMS, kept only as a hash in Redis and verified here), or
 *  the dev bypass. Keyed purely by phoneNumber + a caller-chosen
 *  `purpose` string, with no dependency on auth.users or any other identity table, so a
 *  brand-new caller (like driver-auth) can reuse it as-is instead of duplicating the Redis/MSG91
 *  logic. Callers are responsible for signing whatever short-lived JWT carries their own
 *  handshake state (e.g. a signup/login token, or driver-auth's driver-login-otp token) — this
 *  class only owns the phone-verification side effects. See docs/driver-auth.md and
 *  docs/rbac.md's §2 module-ownership notes. */
export class OtpService {
  constructor(private readonly msg91Client: Msg91Client) {}

  async requestOtpCode(input: {
    phoneNumber: string;
    purpose: string;
    cooldownSeconds: number;
    /** Client IP (req.ip) — for LS_N_0008's per-IP request limit. Omitted = per-phone only. */
    ipAddress?: string | null;
  }): Promise<void> {
    const { phoneNumber, purpose, cooldownSeconds, ipAddress } = input;
    const cooldownKey = this.otpCooldownKey(purpose, phoneNumber);
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError(msg('errors.otp.cooldown'));
    }
    await this.enforceRequestLimit(phoneNumber, ipAddress);
    await redisManager.set(cooldownKey, '1', cooldownSeconds);

    if (useDevOtpBypass()) {
      // Dev-only: no MSG91 call, no real SMS — DEV_BYPASS_OTP is the only code verifyOtpCode
      // will accept while the bypass is active.
      console.info(
        `OTP dev bypass: MSG91 not called for ${phoneNumber} (${purpose}) — NODE_ENV=${env.nodeEnv}, MSG91_AUTH_KEY unset; use ${DEV_BYPASS_OTP}`,
      );
    } else {
      // LS_N_0008: we generate the code and send it as a normal SMS through MSG91's Flow API
      // (MSG91_SMS_TEMPLATE_OTP, code in ##var1##) — not MSG91's OTP API, so MSG91 doesn't
      // verify it: only its hash is kept in Redis and verifyOtpCode checks against that. The
      // same code can also go out over WhatsApp. The code itself is never stored or logged.
      const otp = randomInt(0, 10 ** DEV_BYPASS_OTP.length)
        .toString()
        .padStart(DEV_BYPASS_OTP.length, '0');
      try {
        if (!env.msg91SmsTemplateOtp) {
          throw new Error('MSG91_SMS_TEMPLATE_OTP not configured — cannot send OTP SMS');
        }
        const requestId = await this.msg91Client.sendTransactional(
          phoneNumber,
          { var1: otp },
          env.msg91SmsTemplateOtp,
        );
        // Accepted is not delivered — search this request id in the MSG91 dashboard's SMS
        // reports for the operator delivery status.
        console.info(
          `MSG91 OTP SMS accepted for ${phoneNumber} — request_id=${requestId ?? 'n/a'}`,
        );
      } catch (error) {
        rethrow(error, `Failed to send OTP to ${phoneNumber}`);
      }
      await redisManager.set(
        this.otpCodeKey(purpose, phoneNumber),
        this.hashOtp(otp),
        OTP_CODE_TTL_SECONDS,
      );
      this.sendWhatsappCopy(phoneNumber, otp);
    }

    // A fresh OTP always gets a fresh guess budget — otherwise a stale counter from a previous
    // OTP cycle would unfairly shrink this one's.
    await redisManager.delete(this.otpAttemptsKey(purpose, phoneNumber));
  }

  async verifyOtpCode(input: {
    phoneNumber: string;
    otp: string;
    purpose: string;
    ttlSeconds: number;
    invalidOtpMessage: string | MessageRef;
    tooManyAttemptsMessage: string | MessageRef;
  }): Promise<void> {
    const { phoneNumber, otp, purpose, ttlSeconds, invalidOtpMessage, tooManyAttemptsMessage } =
      input;

    const attemptsKey = this.otpAttemptsKey(purpose, phoneNumber);

    // Counted here — before checking whether the guess is right — so the cap can't be bypassed
    // by any future reordering; a correct guess still costs nothing since success deletes the
    // key immediately below.
    const attempts = await redisManager.incr(attemptsKey, ttlSeconds);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await redisManager.delete(attemptsKey);
      throw new AuthenticationError(tooManyAttemptsMessage);
    }

    const codeKey = this.otpCodeKey(purpose, phoneNumber);
    let matched: boolean;
    if (useDevOtpBypass()) {
      matched = otp === DEV_BYPASS_OTP;
    } else {
      // No stored hash = never sent, already used, or older than OTP_CODE_TTL_SECONDS.
      const storedHash = await redisManager.get(codeKey);
      matched = storedHash !== null && this.hashMatches(storedHash, this.hashOtp(otp));
    }

    if (!matched) {
      throw new AuthenticationError(invalidOtpMessage);
    }

    // One use per code.
    await redisManager.delete(codeKey);
    await redisManager.delete(attemptsKey);
    await redisManager.delete(this.otpCooldownKey(purpose, phoneNumber));
  }

  /** LS_N_0008 throttle — counted separately per phone number and per client IP, across every
   *  OTP purpose (signup/login/driver-login): more than env.otpRequestLimitMax requests within
   *  env.otpRequestLimitWindowSeconds starts an env.otpRequestLockoutSeconds cool-off for that
   *  phone/IP. A request refused here (or by the per-purpose cooldown above) doesn't count. */
  private async enforceRequestLimit(phoneNumber: string, ipAddress?: string | null): Promise<void> {
    const subjects = [`otp-limit:phone:${normalizePhoneNumber(phoneNumber)}`];
    if (ipAddress) subjects.push(`otp-limit:ip:${ipAddress}`);

    for (const subject of subjects) {
      if (await redisManager.get(`${subject}:lockout`)) throw this.lockoutError();
    }
    for (const subject of subjects) {
      const count = await redisManager.incrInFixedWindow(
        `${subject}:count`,
        env.otpRequestLimitWindowSeconds,
      );
      if (count > env.otpRequestLimitMax) {
        await redisManager.set(`${subject}:lockout`, '1', env.otpRequestLockoutSeconds);
        await redisManager.delete(`${subject}:count`); // a fresh window once the cool-off ends
        throw this.lockoutError();
      }
    }
  }

  private lockoutError(): RateLimitError {
    const minutes = Math.ceil(env.otpRequestLockoutSeconds / 60);
    return new RateLimitError(
      `Too many OTP requests. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}`,
    );
  }

  /** Best-effort WhatsApp copy of the same code, once its template is configured — never awaited
   *  by the request, and a failure never affects login (SMS is the primary channel). The code is
   *  never included in logs. */
  private sendWhatsappCopy(phoneNumber: string, otp: string): void {
    if (!env.msg91WhatsappTemplateOtp) return;
    this.msg91Client
      .sendWhatsapp(phoneNumber, [otp], env.msg91WhatsappTemplateOtp)
      .catch((error: unknown) =>
        console.warn(
          `WhatsApp OTP copy to ${phoneNumber} failed: ${error instanceof Error ? error.message.replace(otp, '****') : 'unknown error'}`,
        ),
      );
  }

  private otpRedisKey(purpose: string, phoneNumber: string): string {
    return `${purpose}:${phoneNumber}`;
  }

  private otpAttemptsKey(purpose: string, phoneNumber: string): string {
    return `${this.otpRedisKey(purpose, phoneNumber)}:attempts`;
  }

  private otpCooldownKey(purpose: string, phoneNumber: string): string {
    return `${this.otpRedisKey(purpose, phoneNumber)}:cooldown`;
  }

  private otpCodeKey(purpose: string, phoneNumber: string): string {
    return `${this.otpRedisKey(purpose, phoneNumber)}:code`;
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private hashMatches(storedHash: string, candidateHash: string): boolean {
    const stored = Buffer.from(storedHash);
    const candidate = Buffer.from(candidateHash);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  }
}
