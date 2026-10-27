import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../../db/redis', () => ({
  redisManager: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string | number) => {
      store.set(key, String(value));
      return 'OK';
    }),
    delete: vi.fn(async (key: string) => Number(store.delete(key))),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    incrInFixedWindow: vi.fn(async () => 1),
  },
}));

import { env } from '../../config/env';
import { Msg91Client } from '../../adapters/msg91.client';
import { OtpService } from './otp.service';

const PHONE = '6284333505';
const original = {
  msg91AuthKey: env.msg91AuthKey,
  msg91SmsTemplateOtp: env.msg91SmsTemplateOtp,
  msg91WhatsappTemplateOtp: env.msg91WhatsappTemplateOtp,
};

function build() {
  const client = new Msg91Client();
  const sendTransactional = vi.spyOn(client, 'sendTransactional').mockResolvedValue('req-1');
  return { service: new OtpService(client), sendTransactional };
}

const request = (service: OtpService) =>
  service.requestOtpCode({ phoneNumber: PHONE, purpose: 'login', cooldownSeconds: 30 });

const verify = (service: OtpService, otp: string) =>
  service.verifyOtpCode({
    phoneNumber: PHONE,
    otp,
    purpose: 'login',
    ttlSeconds: 600,
    invalidOtpMessage: 'Invalid OTP',
    tooManyAttemptsMessage: 'Too many attempts',
  });

describe('OtpService (MSG91 Flow SMS)', () => {
  beforeEach(() => {
    store.clear();
    Object.assign(env, {
      msg91AuthKey: 'auth-key',
      msg91SmsTemplateOtp: 'tpl-otp',
      msg91WhatsappTemplateOtp: undefined,
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.assign(env, original);
    vi.restoreAllMocks();
  });

  it('sends the code as var1 on MSG91_SMS_TEMPLATE_OTP', async () => {
    const { service, sendTransactional } = build();
    await request(service);

    expect(sendTransactional).toHaveBeenCalledWith(
      PHONE,
      { var1: expect.stringMatching(/^\d{4}$/) },
      'tpl-otp',
    );
    // Only a hash is stored — never the code itself.
    const sent = sendTransactional.mock.calls[0][1].var1;
    expect([...store.values()]).not.toContain(sent);
  });

  it('accepts the sent code once', async () => {
    const { service, sendTransactional } = build();
    await request(service);
    const sent = sendTransactional.mock.calls[0][1].var1;

    await expect(verify(service, sent)).resolves.toBeUndefined();
    await expect(verify(service, sent)).rejects.toThrow('Invalid OTP');
  });

  it('rejects a wrong code', async () => {
    const { service, sendTransactional } = build();
    await request(service);
    const sent = sendTransactional.mock.calls[0][1].var1;
    const wrong = sent === '0000' ? '1111' : '0000';

    await expect(verify(service, wrong)).rejects.toThrow('Invalid OTP');
  });

  it('rejects when no code was sent (or it expired)', async () => {
    const { service } = build();
    await expect(verify(service, '1234')).rejects.toThrow('Invalid OTP');
  });

  it('fails loudly when MSG91_SMS_TEMPLATE_OTP is not set', async () => {
    env.msg91SmsTemplateOtp = undefined;
    const { service, sendTransactional } = build();

    await expect(request(service)).rejects.toThrow(`Failed to send OTP to ${PHONE}`);
    expect(sendTransactional).not.toHaveBeenCalled();
  });
});
