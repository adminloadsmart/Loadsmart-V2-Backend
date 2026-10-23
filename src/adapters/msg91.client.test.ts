import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { Msg91Client } from './msg91.client';
import { isMsg91SkippedNumber } from '../shared/utils/phone-number';

/** MSG91_SKIP_TEST_NUMBERS as the app would read it. */
const skipTestNumbers = (on: boolean) =>
  vi.spyOn(env, 'msg91SkipTestNumbers', 'get').mockReturnValue(on);

afterEach(() => vi.restoreAllMocks());

describe('isMsg91SkippedNumber', () => {
  it('skips nothing by default (MSG91_SKIP_TEST_NUMBERS not set)', () => {
    expect(env.msg91SkipTestNumbers).toBe(false);
    expect(isMsg91SkippedNumber('8888812345')).toBe(false);
  });

  it('with MSG91_SKIP_TEST_NUMBERS=true, matches 88888… with or without the 91 country code', () => {
    skipTestNumbers(true);
    expect(isMsg91SkippedNumber('8888812345')).toBe(true);
    expect(isMsg91SkippedNumber('918888812345')).toBe(true);
    expect(isMsg91SkippedNumber('+91 88888 12345')).toBe(true);
  });

  it('with MSG91_SKIP_TEST_NUMBERS=true, leaves every other number alone', () => {
    skipTestNumbers(true);
    expect(isMsg91SkippedNumber('9876543210')).toBe(false);
    expect(isMsg91SkippedNumber('8888712345')).toBe(false);
    // 88888 inside the number, not at the start.
    expect(isMsg91SkippedNumber('9888881234')).toBe(false);
  });
});

describe('Msg91Client — test numbers', () => {
  function mockFetch() {
    return (
      vi
        .spyOn(globalThis, 'fetch')
        // A fresh Response per call — a body can only be read once.
        .mockImplementation(async () => new Response(JSON.stringify({ type: 'success' })))
    );
  }

  it('sends SMS and WhatsApp to an 88888 number by default', async () => {
    vi.spyOn(env, 'msg91AuthKey', 'get').mockReturnValue('key');
    vi.spyOn(env, 'msg91WhatsappIntegratedNumber', 'get').mockReturnValue('919999999999');
    const fetch = mockFetch();
    const client = new Msg91Client();
    await client.sendTransactional('8888812345', { title: 't' }, 'template');
    await client.sendWhatsapp('8888812345', ['x'], 'template');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('with MSG91_SKIP_TEST_NUMBERS=true, sends no SMS or WhatsApp to an 88888 number', async () => {
    skipTestNumbers(true);
    const fetch = mockFetch();
    const client = new Msg91Client();
    await client.sendTransactional('8888812345', { title: 't' }, 'template');
    await client.sendWhatsapp('8888812345', ['x'], 'template');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('with MSG91_SKIP_TEST_NUMBERS=true, still sends the login OTP to an 88888 number', async () => {
    skipTestNumbers(true);
    vi.spyOn(env, 'msg91AuthKey', 'get').mockReturnValue('key');
    const fetch = mockFetch();
    await new Msg91Client().sendOtp('8888812345', '1234');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
