import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';
import { normalizePhoneNumber } from '../utils/phone-number';

interface DriverLoginTokenPayload {
  phoneNumber: string;
  driverId: string;
  purpose: string;
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

  if (payload.purpose !== 'driver-login-otp' || !payload.driverId) {
    throw new AuthenticationError('Invalid login token');
  }

  req.driverLoginPayload = {
    phoneNumber: normalizePhoneNumber(payload.phoneNumber),
    driverId: payload.driverId,
  };
  next();
};
