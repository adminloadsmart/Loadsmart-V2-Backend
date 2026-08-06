import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';

interface SignupTokenPayload {
  phoneNumber: string;
  purpose: string;
}

/**
 * Reads the signup token the same way createAuth reads the main access token — via
 * `Authorization: Bearer <token>` — not from the body. It's a distinct, purpose-scoped JWT
 * (checked below), not interchangeable with the access/refresh pair, but the transport is
 * identical to every other protected route for consistency.
 */
export const verifySignupToken: RequestHandler = (req, _res, next) => {
  const signupToken = extractBearerToken(req);
  if (!signupToken) {
    throw new AuthenticationError('Missing signup token');
  }

  let payload: SignupTokenPayload;
  try {
    payload = verifyToken<SignupTokenPayload>(signupToken);
  } catch {
    throw new AuthenticationError('Invalid or expired signup token');
  }

  if (payload.purpose !== 'signup') {
    throw new AuthenticationError('Invalid signup token');
  }

  req.signupPayload = { phoneNumber: payload.phoneNumber };
  next();
};
