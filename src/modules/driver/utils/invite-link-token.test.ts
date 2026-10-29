import { describe, expect, it } from 'vitest';
import { invitationIdFromLinkToken, inviteLinkToken } from './invite-link-token';

const ID = '7d0f3c1e-5a52-4f0e-9a39-2b1f8f6a7c11';

describe('invite link token', () => {
  it('round-trips to the invitation id', () => {
    expect(invitationIdFromLinkToken(inviteLinkToken(ID))).toBe(ID);
  });

  it('rejects a tampered or malformed token', () => {
    const [, signature] = inviteLinkToken(ID).split('.');
    expect(invitationIdFromLinkToken(`${ID.replace('7', '8')}.${signature}`)).toBeNull();
    expect(invitationIdFromLinkToken(ID)).toBeNull();
    expect(invitationIdFromLinkToken(`${inviteLinkToken(ID)}.x`)).toBeNull();
  });
});
