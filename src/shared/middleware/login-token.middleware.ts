import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';
import { normalizePhoneNumber } from '../utils/phone-number';

interface LoginTokenPayload {
  phoneNumber: string;
  purpose: string;
}

/**
 * Reads the login OTP token the same way other bearer tokens are transported:
 * `Authorization: Bearer <token>`.
 *
 * It is purpose-scoped and short-lived, so it is not interchangeable with the access/refresh
 * pair and only authorizes POST /v1/auth/login/otp/verify.
 */
export const verifyLoginToken: RequestHandler = (req, _res, next) => {
  const loginToken = extractBearerToken(req);
  if (!loginToken) {
    throw new AuthenticationError('Missing login token');
  }

  let payload: LoginTokenPayload;
  try {
    payload = verifyToken<LoginTokenPayload>(loginToken);
  } catch {
    throw new AuthenticationError('Invalid or expired login token');
  }

  if (payload.purpose !== 'login') {
    throw new AuthenticationError('Invalid login token');
  }

  req.loginPayload = { phoneNumber: normalizePhoneNumber(payload.phoneNumber) };
  next();
};
