import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import {
  DRIVER_INVITE_LINK_SIGNATURE_LENGTH,
  DRIVER_INVITE_LINK_TOKEN_PURPOSE,
} from '../driver.constants';

// The invite WhatsApp's tracked app link carries `<invitationId>.<signature>` — signed so nobody
// can mark someone else's invite as opened by guessing ids. Same link on every Resend; a tap only
// counts toward the send it follows (see DriverService.recordInviteLinkOpened).

function signatureOf(invitationId: string): string {
  return createHmac('sha256', env.jwtSecret)
    .update(`${DRIVER_INVITE_LINK_TOKEN_PURPOSE}:${invitationId}`)
    .digest('base64url')
    .slice(0, DRIVER_INVITE_LINK_SIGNATURE_LENGTH);
}

export function inviteLinkToken(invitationId: string): string {
  return `${invitationId}.${signatureOf(invitationId)}`;
}

/** The invitation id a token was signed for; null when it's malformed or the signature is wrong. */
export function invitationIdFromLinkToken(token: string): string | null {
  const [invitationId, signature, extra] = token.split('.');
  if (!invitationId || !signature || extra !== undefined) return null;
  const expected = Buffer.from(signatureOf(invitationId));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? invitationId
    : null;
}

/** The link the invite WhatsApp sends — null when API_PUBLIC_URL isn't set (plain app link then). */
export function inviteTrackedLink(invitationId: string): string | null {
  return env.apiPublicUrl
    ? `${env.apiPublicUrl}${API_VERSION_PREFIX}/driver-invites/open/${inviteLinkToken(invitationId)}`
    : null;
}
