import { Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { createHash } from 'crypto';
import { env } from '../../config/env';

export function signToken(payload: object, expiresInSeconds: number): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: expiresInSeconds, algorithm: 'HS256' });
}

// Explicit algorithms allowlist — defense-in-depth against algorithm-confusion attacks even
// though only a symmetric secret is used here today (no RS/ES keys anywhere in this app).
export function verifyToken<T extends JwtPayload = JwtPayload>(token: string): T {
  return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as T;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Shared by auth.middleware.ts and signup-token.middleware.ts — every bearer token this API accepts arrives the same way. */
export function extractBearerToken(req: Request): string | null {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}
