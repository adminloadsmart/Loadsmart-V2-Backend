// src/config/env.ts
import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function numberWithDefault(key: string, defaultValue: number): number {
  const val = process.env[key];
  return val ? Number(val) : defaultValue;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = required('JWT_SECRET');
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MIN_JWT_SECRET_LENGTH = 32;
if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
  const message = `JWT_SECRET is only ${jwtSecret.length} chars — should be at least ${MIN_JWT_SECRET_LENGTH} for a symmetric HMAC secret`;
  // Hard-fail in production; warn everywhere else so short dev/local secrets keep working.
  if (nodeEnv === 'production') {
    throw new Error(message);
  }
  console.warn(`⚠ ${message}`);
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  corsOrigins,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  accessTokenTtlSeconds: numberWithDefault('ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
  refreshTokenTtlMs: numberWithDefault('REFRESH_TOKEN_TTL_MS', 30 * 24 * 60 * 60 * 1000),
  signupOtpTtlSeconds: numberWithDefault('SIGNUP_OTP_TTL_SECONDS', 600),
  loginOtpTtlSeconds: numberWithDefault('LOGIN_OTP_TTL_SECONDS', 600),
  loginOtpResendCooldownSeconds: numberWithDefault('LOGIN_OTP_RESEND_COOLDOWN_SECONDS', 30),
  userExistsCacheTtlSeconds: numberWithDefault('USER_EXISTS_CACHE_TTL_SECONDS', 30),
  // Per-IP request throttles on the unauthenticated auth endpoints — defense-in-depth alongside
  // the (email, ip)-scoped login lockout and the per-phone OTP attempt cap.
  loginRateLimitMax: numberWithDefault('LOGIN_RATE_LIMIT_MAX', 20),
  loginRateLimitWindowSeconds: numberWithDefault('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 300),
  loginOtpRequestRateLimitMax: numberWithDefault('LOGIN_OTP_REQUEST_RATE_LIMIT_MAX', 20),
  loginOtpRequestRateLimitWindowSeconds: numberWithDefault(
    'LOGIN_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS',
    300,
  ),
  loginOtpVerifyRateLimitMax: numberWithDefault('LOGIN_OTP_VERIFY_RATE_LIMIT_MAX', 20),
  loginOtpVerifyRateLimitWindowSeconds: numberWithDefault(
    'LOGIN_OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS',
    300,
  ),
  verifyOtpRateLimitMax: numberWithDefault('VERIFY_OTP_RATE_LIMIT_MAX', 20),
  verifyOtpRateLimitWindowSeconds: numberWithDefault('VERIFY_OTP_RATE_LIMIT_WINDOW_SECONDS', 300),
  signupRateLimitMax: numberWithDefault('SIGNUP_RATE_LIMIT_MAX', 20),
  signupRateLimitWindowSeconds: numberWithDefault('SIGNUP_RATE_LIMIT_WINDOW_SECONDS', 300),
  // Throttles POST /drivers/verify-dl — it fans out to IDfy's paid Sarathi lookup.
  driverVerifyDlRateLimitMax: numberWithDefault('DRIVER_VERIFY_DL_RATE_LIMIT_MAX', 3),
  driverVerifyDlRateLimitWindowSeconds: numberWithDefault(
    'DRIVER_VERIFY_DL_RATE_LIMIT_WINDOW_SECONDS',
    60,
  ),
  // IDfy's `verify_with_source` DL check (Sarathi registry). SarathiClient falls back to
  // manual_review whenever any of these is missing, so the app runs fine without them.
  idfyApiKey: process.env.IDFY_API_KEY || undefined,
  idfyAccountId: process.env.IDFY_ACCOUNT_ID || undefined,
  idfyBaseUrl: process.env.IDFY_BASE_URL || 'https://eve.idfy.com',
  // Fixed per this account's IDfy workspace setup, not generated per call.
  idfyTaskId: process.env.IDFY_TASK_ID || undefined,
  idfyGroupId: process.env.IDFY_GROUP_ID || undefined,
};
