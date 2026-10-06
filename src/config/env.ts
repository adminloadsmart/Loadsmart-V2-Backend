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
  // LS_N_0008 throttle, applied to every OTP request (staff signup/login, driver login) by
  // shared/services/otp.service.ts — separately per phone number and per client IP (req.ip, the
  // same key the existing per-IP rate limiter uses): more than OTP_REQUEST_LIMIT_MAX requests
  // within OTP_REQUEST_LIMIT_WINDOW_SECONDS locks that phone/IP out of OTP requests for
  // OTP_REQUEST_LOCKOUT_SECONDS. Sheet defaults: 3 in 15 minutes, then a 30-minute cool-off.
  otpRequestLimitMax: numberWithDefault('OTP_REQUEST_LIMIT_MAX', 3),
  otpRequestLimitWindowSeconds: numberWithDefault('OTP_REQUEST_LIMIT_WINDOW_SECONDS', 15 * 60),
  otpRequestLockoutSeconds: numberWithDefault('OTP_REQUEST_LOCKOUT_SECONDS', 30 * 60),
  userExistsCacheTtlSeconds: numberWithDefault('USER_EXISTS_CACHE_TTL_SECONDS', 30),
  permissionsVersionCacheTtlSeconds: numberWithDefault('PERMISSIONS_VERSION_CACHE_TTL_SECONDS', 30),
  // Driver-app auth — a separate identity domain from auth.users (see docs/driver-auth.md), with
  // its own TTLs so they can be tuned independently of the staff/org values above.
  driverAccessTokenTtlSeconds: numberWithDefault('DRIVER_ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
  driverRefreshTokenTtlMs: numberWithDefault(
    'DRIVER_REFRESH_TOKEN_TTL_MS',
    30 * 24 * 60 * 60 * 1000,
  ),
  driverLoginOtpTtlSeconds: numberWithDefault('DRIVER_LOGIN_OTP_TTL_SECONDS', 600),
  driverLoginOtpResendCooldownSeconds: numberWithDefault(
    'DRIVER_LOGIN_OTP_RESEND_COOLDOWN_SECONDS',
    30,
  ),
  // Short-lived — just long enough for the client to render a tenant picker and post the choice
  // back; see driver-auth.service.ts's requestOtp/verifyOtp/selectTenant.
  driverTenantSelectTtlSeconds: numberWithDefault('DRIVER_TENANT_SELECT_TTL_SECONDS', 5 * 60),
  driverLoginOtpRequestRateLimitMax: numberWithDefault(
    'DRIVER_LOGIN_OTP_REQUEST_RATE_LIMIT_MAX',
    20,
  ),
  driverLoginOtpRequestRateLimitWindowSeconds: numberWithDefault(
    'DRIVER_LOGIN_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS',
    300,
  ),
  driverLoginOtpVerifyRateLimitMax: numberWithDefault('DRIVER_LOGIN_OTP_VERIFY_RATE_LIMIT_MAX', 20),
  driverLoginOtpVerifyRateLimitWindowSeconds: numberWithDefault(
    'DRIVER_LOGIN_OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS',
    300,
  ),
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
  awsRegion: required('AWS_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
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
  // MSG91's OTP API (Msg91Client) — generates and verifies signup/login OTPs; we never see the
  // code ourselves. Left optional so the app still boots without them: auth.service.ts falls
  // back to a fixed dev-only OTP outside production when these aren't set (see
  // auth.constants.ts's useDevOtpBypass).
  msg91AuthKey: process.env.MSG91_AUTH_KEY || undefined,
  // DLT-approved SMS template id, provisioned on the MSG91 dashboard — required by Indian
  // carriers for delivery, independent of whether the code itself is correct.
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID || undefined,
  msg91BaseUrl: process.env.MSG91_BASE_URL || 'https://control.msg91.com',
  // MSG91's Flow API template id for transactional/notification SMS (SmsChannel) — a separate
  // DLT-approved template from msg91TemplateId above (that one's OTP-only, a different API).
  // Optional: SmsChannel throws a clear per-delivery error when unset instead of crashing the
  // server, same "fails loudly but doesn't crash boot" contract as msg91AuthKey/idfyApiKey.
  msg91NotificationTemplateId: process.env.MSG91_NOTIFICATION_TEMPLATE_ID || undefined,
  // MSG91's WhatsApp Business API (WhatsappChannel) — a Meta-approved template, provisioned on
  // the MSG91/WhatsApp Business dashboard, not composed in code (see Msg91Client.sendWhatsapp).
  // Optional, same "fails loudly but doesn't crash boot" contract as the MSG91 vars above.
  msg91WhatsappIntegratedNumber: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER || undefined,
  msg91WhatsappNamespace: process.env.MSG91_WHATSAPP_NAMESPACE || undefined,
  msg91WhatsappTemplateName: process.env.MSG91_WHATSAPP_TEMPLATE_NAME || undefined,
  // MSG91's WhatsApp send API lives on a different host (api.msg91.com) from the rest of their
  // v5 API (msg91BaseUrl/control.msg91.com) — see Msg91Client.sendWhatsapp.
  msg91WhatsappBaseUrl: process.env.MSG91_WHATSAPP_BASE_URL || 'https://api.msg91.com',
  // MSG91 Email API (EmailChannel) — sends from a domain verified on the MSG91 dashboard, using a
  // template created there. Optional, same "fails loudly but doesn't crash boot" contract.
  msg91EmailDomain: process.env.MSG91_EMAIL_DOMAIN || undefined,
  msg91EmailFrom: process.env.MSG91_EMAIL_FROM || undefined,
  msg91EmailFromName: process.env.MSG91_EMAIL_FROM_NAME || 'Loadsmart',
  // Optional reply-to for notification emails (e.g. a monitored sales/support inbox) — LS_N_0004
  // asks the applicant to "reply to this mail". Unset = no reply-to, replies go to MSG91_EMAIL_FROM.
  msg91EmailReplyTo: process.env.MSG91_EMAIL_REPLY_TO || undefined,
  // Per-notification-type MSG91 templates (see catalog/notification-catalog.ts's `templates`) —
  // LS_N_0001 "account approved". Optional until provisioned on the MSG91 dashboard.
  msg91WhatsappTemplateOrgApproved: process.env.MSG91_WHATSAPP_TEMPLATE_ORG_APPROVED || undefined,
  msg91SmsTemplateOrgApproved: process.env.MSG91_SMS_TEMPLATE_ORG_APPROVED || undefined,
  msg91EmailTemplateOrgApproved: process.env.MSG91_EMAIL_TEMPLATE_ORG_APPROVED || undefined,
  // LS_N_0008 login OTP — optional WhatsApp copy of the same code (Meta-approved template whose
  // {{1}} is the OTP). Unset = SMS only, exactly as before.
  msg91WhatsappTemplateOtp: process.env.MSG91_WHATSAPP_TEMPLATE_OTP || undefined,
  // LS_N_0002 "signup received, under review" (SMS + email only).
  msg91SmsTemplateSignupReceived: process.env.MSG91_SMS_TEMPLATE_SIGNUP_RECEIVED || undefined,
  msg91EmailTemplateSignupReceived: process.env.MSG91_EMAIL_TEMPLATE_SIGNUP_RECEIVED || undefined,
  // LS_N_0003 "more information needed" — a KYC document couldn't be verified (SMS + email only).
  msg91SmsTemplateDocumentPending: process.env.MSG91_SMS_TEMPLATE_DOCUMENT_PENDING || undefined,
  msg91EmailTemplateDocumentPending: process.env.MSG91_EMAIL_TEMPLATE_DOCUMENT_PENDING || undefined,
  // LS_N_0004 "account not approved" (email only).
  msg91EmailTemplateOrgNotApproved: process.env.MSG91_EMAIL_TEMPLATE_ORG_NOT_APPROVED || undefined,
  // LS_N_0005 "team member invited" (SMS + email) and LS_N_0006 "your access changed" (email).
  msg91SmsTemplateTeamInvite: process.env.MSG91_SMS_TEMPLATE_TEAM_INVITE || undefined,
  msg91EmailTemplateTeamInvite: process.env.MSG91_EMAIL_TEMPLATE_TEAM_INVITE || undefined,
  msg91EmailTemplateAccessChanged: process.env.MSG91_EMAIL_TEMPLATE_ACCESS_CHANGED || undefined,
  // LS_N_0047 vehicle document expiring (SMS + weekly roll-up email) / LS_N_0048 expired (SMS + email).
  msg91SmsTemplateDocExpiring: process.env.MSG91_SMS_TEMPLATE_DOC_EXPIRING || undefined,
  msg91EmailTemplateDocRollup: process.env.MSG91_EMAIL_TEMPLATE_DOC_ROLLUP || undefined,
  msg91SmsTemplateDocExpired: process.env.MSG91_SMS_TEMPLATE_DOC_EXPIRED || undefined,
  msg91EmailTemplateDocExpired: process.env.MSG91_EMAIL_TEMPLATE_DOC_EXPIRED || undefined,
  // LS_N_0049 driver licence expired (SMS).
  msg91SmsTemplateDlExpired: process.env.MSG91_SMS_TEMPLATE_DL_EXPIRED || undefined,
  // LS_N_0054 driver-reported breakdown (SMS + WhatsApp).
  msg91SmsTemplateBreakdown: process.env.MSG91_SMS_TEMPLATE_BREAKDOWN || undefined,
  msg91WhatsappTemplateBreakdown: process.env.MSG91_WHATSAPP_TEMPLATE_BREAKDOWN || undefined,
  // LS_N_0056 service due soon / LS_N_0057 service overdue (SMS).
  msg91SmsTemplateServiceDue: process.env.MSG91_SMS_TEMPLATE_SERVICE_DUE || undefined,
  msg91SmsTemplateServiceOverdue: process.env.MSG91_SMS_TEMPLATE_SERVICE_OVERDUE || undefined,
  // LS_N_0060 daily morning brief (WhatsApp + email).
  msg91WhatsappTemplateDailyBrief: process.env.MSG91_WHATSAPP_TEMPLATE_DAILY_BRIEF || undefined,
  msg91EmailTemplateDailyBrief: process.env.MSG91_EMAIL_TEMPLATE_DAILY_BRIEF || undefined,
  // Firebase Cloud Messaging — push notifications (PushChannel). Optional: the app boots fine
  // without these; PushChannel throws a clear per-delivery error instead of crashing the server
  // or silently no-op-ing.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || undefined,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || undefined,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || undefined,
};
