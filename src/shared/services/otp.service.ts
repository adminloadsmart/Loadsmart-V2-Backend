import { RateLimitError, AuthenticationError, rethrow } from '../errors';
import { redisManager } from '../../db/redis';
import { Msg91Client } from '../../adapters/msg91.client';
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
  }): Promise<void> {
    const { phoneNumber, purpose, cooldownSeconds } = input;
    const cooldownKey = this.otpCooldownKey(purpose, phoneNumber);
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError('Please wait before requesting another OTP');
    }
    await redisManager.set(cooldownKey, '1', cooldownSeconds);

    if (useDevOtpBypass()) {
      // Dev-only: no MSG91 call, no real SMS — DEV_BYPASS_OTP is the only code verifyOtpCode
      // will accept while the bypass is active.
    } else {
      try {
        await this.msg91Client.sendOtp(phoneNumber);
      } catch (error) {
        rethrow(error, `Failed to send OTP to ${phoneNumber}`);
      }
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
    invalidOtpMessage: string;
    tooManyAttemptsMessage: string;
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
