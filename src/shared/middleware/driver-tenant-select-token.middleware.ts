import { RequestHandler } from 'express';
import { AuthenticationError } from '../errors';
import { extractBearerToken, verifyToken } from '../utils/token';
import { DriverLoginCandidate } from '../../modules/driver/driver-auth.types';

interface DriverTenantSelectTokenPayload {
  purpose: string;
  candidates: DriverLoginCandidate[];
}

/**
 * Guards POST /v1/driver-auth/otp/select-tenant — only reachable after an OTP has already been
 * verified for a phone number matching more than one tenant's active driver record (see
 * driver-auth.service.ts's verifyOtp). Purpose-scoped (`driver-tenant-select`) and short-lived
 * (env.driverTenantSelectTtlSeconds); the candidate list travels inside the token itself so the
 * client never resubmits it, and can't be tampered with client-side. See docs/driver-auth.md.
 */
export const verifyDriverTenantSelectToken: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError('Missing tenant selection token');
  }

  let payload: DriverTenantSelectTokenPayload;
  try {
    payload = verifyToken<DriverTenantSelectTokenPayload>(token);
  } catch {
    throw new AuthenticationError('Invalid or expired tenant selection token');
  }

  if (payload.purpose !== 'driver-tenant-select' || !Array.isArray(payload.candidates)) {
    throw new AuthenticationError('Invalid tenant selection token');
  }

  req.driverTenantSelectPayload = { candidates: payload.candidates };
  next();
};
