import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';
import { normalizePhoneNumber } from '../utils/phone-number';
import { DriverLoginCandidate } from '../../modules/driver/driver-auth.types';

interface DriverLoginTokenPayload {
  phoneNumber: string;
  purpose: string;
  candidates: DriverLoginCandidate[];
}

/**
 * Driver-app counterpart to login-token.middleware.ts's verifyLoginToken — reads the OTP
 * handshake token the same way every bearer token is transported (`Authorization: Bearer
 * <token>`), not from the body. Purpose-scoped (`driver-login-otp`) and short-lived, so it is not
 * interchangeable with a driver access/refresh pair, and only authorizes
 * POST /v1/driver-auth/otp/verify. See docs/driver-auth.md.
 */
export const verifyDriverLoginToken: RequestHandler = (req, _res, next) => {
  const loginToken = extractBearerToken(req);
  if (!loginToken) {
    throw new AuthenticationError('Missing login token');
  }

  let payload: DriverLoginTokenPayload;
  try {
    payload = verifyToken<DriverLoginTokenPayload>(loginToken);
  } catch {
    throw new AuthenticationError('Invalid or expired login token');
  }

  if (payload.purpose !== 'driver-login-otp' || !Array.isArray(payload.candidates)) {
    throw new AuthenticationError('Invalid login token');
  }

  req.driverLoginPayload = {
    phoneNumber: normalizePhoneNumber(payload.phoneNumber),
    candidates: payload.candidates,
  };
  next();
};
