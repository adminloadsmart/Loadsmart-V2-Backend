import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';
import { normalizePhoneNumber } from '../utils/phone-number';

interface DriverRegisterOtpTokenPayload {
  phoneNumber: string;
  purpose: string;
}

/**
 * Guards POST /v1/driver-auth/register/otp/verify — same shape as driver-login-token.middleware.ts's
 * verifyDriverLoginToken, but for the self-registration flow (a phone with no driver profile yet,
 * as opposed to login's "phone must already be registered"). Purpose-scoped
 * (`driver-register-otp`) and short-lived. See driver-identity.service.ts's verifyOtp, which
 * creates the driver profile and issues a real session right after this token is consumed — there
 * is no further "registration token" step after this one.
 */
export const verifyDriverRegisterOtpToken: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError('Missing OTP token');
  }

  let payload: DriverRegisterOtpTokenPayload;
  try {
    payload = verifyToken<DriverRegisterOtpTokenPayload>(token);
  } catch {
    throw new AuthenticationError('Invalid or expired OTP token');
  }

  if (payload.purpose !== 'driver-register-otp' || !payload.phoneNumber) {
    throw new AuthenticationError('Invalid OTP token');
  }

  req.driverRegisterOtpPayload = { phoneNumber: normalizePhoneNumber(payload.phoneNumber) };
  next();
};
