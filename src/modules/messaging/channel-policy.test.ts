import { describe, expect, it } from 'vitest';
import { applyChannelPolicy } from './channel-policy';

const ALL = ['whatsapp', 'sms', 'email', 'push'] as const;

describe('applyChannelPolicy (load module spec p.30–32)', () => {
  it('shipper: actions keep WhatsApp; updates drop only WhatsApp (email / SMS / push stay)', () => {
    expect(
      applyChannelPolicy({ recipientKind: 'shipper_user', intent: 'action', channels: ALL })
        .channels,
    ).toEqual([...ALL]);
    expect(
      applyChannelPolicy({ recipientKind: 'shipper_user', intent: 'update', channels: ALL }),
    ).toEqual({
      channels: ['sms', 'email', 'push'],
      suppressed: [{ channel: 'whatsapp', reason: 'update_app_only' }],
    });
  });

  it('shipper: no WhatsApp about a load before its memo — own fleet has no memo step', () => {
    const beforeMemo = { hasMemoStep: true, memoSent: false };
    expect(
      applyChannelPolicy({
        recipientKind: 'shipper_user',
        intent: 'action',
        channels: ['whatsapp'],
        load: beforeMemo,
      }).suppressed,
    ).toEqual([{ channel: 'whatsapp', reason: 'before_load_memo' }]);
    expect(
      applyChannelPolicy({
        recipientKind: 'shipper_user',
        intent: 'action',
        channels: ['whatsapp'],
        load: { hasMemoStep: true, memoSent: true },
      }).channels,
    ).toEqual(['whatsapp']);
    expect(
      applyChannelPolicy({
        recipientKind: 'shipper_user',
        intent: 'action',
        channels: ['whatsapp'],
        load: { hasMemoStep: false, memoSent: false },
      }).channels,
    ).toEqual(['whatsapp']);
  });

  it('unclassified types (intent null) keep their channels', () => {
    expect(
      applyChannelPolicy({ recipientKind: 'shipper_user', intent: null, channels: ALL }).channels,
    ).toEqual([...ALL]);
  });

  it('broker / transporter / partner: WhatsApp only', () => {
    for (const recipientKind of ['transporter', 'partner'] as const) {
      expect(
        applyChannelPolicy({ recipientKind, intent: 'update', channels: ALL }).channels,
      ).toEqual(['whatsapp']);
    }
  });

  it('receiver: SMS only', () => {
    expect(
      applyChannelPolicy({ recipientKind: 'receiver', intent: 'update', channels: ALL }).channels,
    ).toEqual(['sms']);
  });

  it('driver: the app if registered, else WhatsApp', () => {
    expect(
      applyChannelPolicy({
        recipientKind: 'driver',
        intent: 'action',
        channels: ['whatsapp', 'push', 'sms'],
        driverHasApp: true,
      }).channels,
    ).toEqual(['push', 'sms']);
    expect(
      applyChannelPolicy({
        recipientKind: 'driver',
        intent: 'action',
        channels: ['whatsapp', 'sms'],
        driverHasApp: false,
      }).channels,
    ).toEqual(['whatsapp', 'sms']);
  });
});
