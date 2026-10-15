import { randomInt } from 'crypto';
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

/** Phone-number OTP primitive shared by every OTP-based login flow in this codebase (staff
 *  signup/login in modules/auth/auth.service.ts, driver login in
 *  modules/driver/driver-auth.service.ts) — Redis-backed cooldown/attempt tracking plus the
 *  MSG91 send/verify calls (or the dev bypass). Keyed purely by phoneNumber + a caller-chosen
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
    } else {
      // LS_N_0008: we generate the code ourselves and hand it to MSG91, which sends it with the
      // registered LS_OTP SMS template and later verifies exactly this code (verifyOtpCode below
      // is unchanged) — so the same code can also go out over WhatsApp. Never stored or logged.
      const otp = randomInt(0, 10 ** DEV_BYPASS_OTP.length)
        .toString()
        .padStart(DEV_BYPASS_OTP.length, '0');
      try {
        await this.msg91Client.sendOtp(phoneNumber, otp);
      } catch (error) {
        rethrow(error, `Failed to send OTP to ${phoneNumber}`);
      }
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
    // key immediately below. Also spares a paid MSG91 call once the guess budget is already
    // exhausted.
    const attempts = await redisManager.incr(attemptsKey, ttlSeconds);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await redisManager.delete(attemptsKey);
      throw new AuthenticationError(tooManyAttemptsMessage);
    }

    let matched: boolean;
    if (useDevOtpBypass()) {
      matched = otp === DEV_BYPASS_OTP;
    } else {
      try {
        matched = await this.msg91Client.verifyOtp(phoneNumber, otp);
      } catch (error) {
        rethrow(error, `Failed to verify OTP for ${phoneNumber}`);
      }
    }

    if (!matched) {
      throw new AuthenticationError(invalidOtpMessage);
    }

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
}
