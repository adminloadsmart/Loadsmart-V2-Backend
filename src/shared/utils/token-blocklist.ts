import { redisManager } from '../../db/redis';

const BLOCKLIST_PREFIX = 'access-token-blocklist:';

// Unlike isTokenBlocked's read-path fail-open (below), this must fail loud: logout()/
// deleteAccount() call this last, and if it throws they propagate a real error to the caller
// instead of silently reporting { success: true } while the access token was never actually
// revoked (any refresh-token revocation done earlier in those calls still stands either way).
export async function blockToken(jti: string | undefined, exp: number | undefined): Promise<void> {
  if (!jti || !exp) return;

  const ttlSeconds = exp - Math.floor(Date.now() / 1000);
  if (ttlSeconds <= 0) return;

  await redisManager.set(`${BLOCKLIST_PREFIX}${jti}`, '1', ttlSeconds);
}

export async function isTokenBlocked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;

  // Fails open by design: a Redis outage degrades revocation-checking (an already-issued,
  // recently-revoked token stays valid until its own TTL expires) rather than taking down every
  // authenticated request in the app on a Redis blip. Bounded blast radius = the access token
  // TTL (15 min by default).
  try {
    return (await redisManager.get(`${BLOCKLIST_PREFIX}${jti}`)) !== null;
  } catch (err) {
    console.error('Failed to check token blocklist', err);
    return false;
  }
}
