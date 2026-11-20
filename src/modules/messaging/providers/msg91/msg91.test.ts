import { describe, expect, it } from 'vitest';
import { NormalizedMessage, NormalizedStatus } from '../whatsapp-provider.interface';
import { Msg91WebhookParser } from './msg91-webhook.parser';
import { Msg91WhatsappProvider, sendResultOf } from './msg91-whatsapp.provider';
import { templateExtraComponents } from '../../../../adapters/msg91.client';

/**
 * Fixtures follow MSG91's "How to Receive WhatsApp Delivery Reports via Webhook (New)": `direction`
 * 0 = inbound / 1 = outbound, `customerNumber`, `uuid` (the Meta WAMID), `requestId`, `eventName`,
 * `replyMsgId` (the message the user replied to or tapped), `contentType`, and `button` / `content`
 * sent as stringified JSON. Replace them with real captured payloads after the first live run.
 */
const parser = new Msg91WebhookParser({ token: 'secret-token' });

describe('Msg91WebhookParser — auth', () => {
  it('accepts only the ?token= set in the MSG91 panel', () => {
    expect(parser.verifyRequest({ headers: {}, query: { token: 'secret-token' } })).toBe(true);
    expect(parser.verifyRequest({ headers: {}, query: { token: 'wrong' } })).toBe(false);
    expect(parser.verifyRequest({ headers: {}, query: {} })).toBe(false);
    expect(
      new Msg91WebhookParser({ token: undefined }).verifyRequest({
        headers: {},
        query: { token: '' },
      }),
    ).toBe(false);
  });
});

describe('Msg91WebhookParser — inbound messages (direction 0)', () => {
  it('a typed text, with the sender as 91XXXXXXXXXX', () => {
    const [message] = parser.parse({
      customerNumber: '919876543210',
      uuid: 'wamid.IN1',
      direction: 0,
      contentType: 'text',
      text: '45k PB10AB1234',
      replyMsgId: '',
      integratedNumber: '919000000000',
      ts: '1794577870',
    }) as NormalizedMessage[];
    expect(message).toMatchObject({
      kind: 'message',
      provider: 'msg91',
      providerMessageId: 'wamid.IN1',
      fromPhone: '919876543210',
      contextMessageId: null,
      type: 'text',
      text: '45k PB10AB1234',
    });
    expect(message.timestamp.toISOString()).toBe(new Date(1794577870 * 1000).toISOString());
  });

  it('a template quick-reply tap: stringified `button` (even twice) + replyMsgId of the tapped template', () => {
    const [message] = parser.parse({
      customerNumber: '919876543210',
      uuid: 'wamid.TAP1',
      direction: '0',
      contentType: 'button',
      button: JSON.stringify(JSON.stringify({ payload: 'Negotiate', text: 'Negotiate' })),
      replyMsgId: 'wamid.OFFER1',
    }) as NormalizedMessage[];
    expect(message).toMatchObject({
      type: 'button',
      buttonId: 'Negotiate',
      buttonText: 'Negotiate',
      contextMessageId: 'wamid.OFFER1',
    });
  });

  it('a session reply button and a "Choose load" list pick (stringified `content`)', () => {
    const [button, pick] = parser.parse([
      {
        customerNumber: '919876543210',
        uuid: 'wamid.B1',
        direction: 0,
        contentType: 'interactive',
        content: JSON.stringify({
          type: 'button_reply',
          button_reply: { id: 'accept:LOAD-0042:r1', title: 'Accept' },
        }),
        replyMsgId: 'wamid.SESSION',
      },
      {
        customerNumber: '919876543210',
        uuid: 'wamid.L1',
        direction: 0,
        contentType: 'interactive',
        content: JSON.stringify({
          interactive: {
            type: 'list_reply',
            list_reply: { id: 'load:LOAD-0042', title: 'LOAD-0042' },
          },
        }),
        replyMsgId: 'wamid.PICKER',
      },
    ]) as NormalizedMessage[];
    expect(button).toMatchObject({
      type: 'button',
      buttonId: 'accept:LOAD-0042:r1',
      contextMessageId: 'wamid.SESSION',
    });
    expect(pick).toMatchObject({
      type: 'list_pick',
      listRowId: 'load:LOAD-0042',
      contextMessageId: 'wamid.PICKER',
    });
  });

  it('a photo with its download link', () => {
    const [message] = parser.parse({
      customerNumber: '919876543210',
      uuid: 'wamid.IMG',
      direction: 0,
      contentType: 'image',
      content: JSON.stringify({ url: 'https://media.example/slip.jpg', mime_type: 'image/jpeg' }),
    }) as NormalizedMessage[];
    expect(message).toMatchObject({
      type: 'image',
      media: { ref: 'https://media.example/slip.jpg', mimeType: 'image/jpeg' },
    });
  });

  it('an inbound without a message id still gets a stable id, so a re-delivery dedupes', () => {
    const payload = {
      customerNumber: '919876543210',
      direction: 0,
      contentType: 'text',
      text: '40k',
      ts: '1794577870',
    };
    const [first] = parser.parse(payload) as NormalizedMessage[];
    const [again] = parser.parse({ ...payload }) as NormalizedMessage[];
    expect(first.providerMessageId).toMatch(/^msg91-/);
    expect(again.providerMessageId).toBe(first.providerMessageId);
  });
});

describe('Msg91WebhookParser — delivery reports (direction 1)', () => {
  it('sent / read with the WAMID (`uuid`), request id and number; a wrapped batch', () => {
    const events = parser.parse({
      data: [
        {
          requestId: 'req-1',
          uuid: 'wamid.OUT1',
          eventName: 'sent',
          direction: 1,
          customerNumber: '919876543210',
          ts: 1794577873,
        },
        {
          requestId: 'req-1',
          uuid: 'wamid.OUT1',
          eventName: 'read',
          direction: 1,
          customerNumber: '919876543210',
          ts: 1794577874,
        },
      ],
    }) as NormalizedStatus[];
    expect(events.map((event) => event.status)).toEqual(['sent', 'read']);
    expect(events[1]).toMatchObject({
      kind: 'status',
      providerMessageId: 'wamid.OUT1',
      providerRequestId: 'req-1',
      recipientPhone: '919876543210',
      error: null,
    });
  });

  it('failed carries the first error', () => {
    const [event] = parser.parse({
      requestId: 'req-2',
      uuid: 'wamid.OUT2',
      eventName: 'failed',
      direction: 1,
      customerNumber: '919876543210',
      errors: [{ code: 131047, title: 'Re-engagement message' }],
    }) as NormalizedStatus[];
    expect(event).toMatchObject({
      status: 'failed',
      error: { code: '131047', title: 'Re-engagement message' },
    });
  });

  it('ignores reports it does not know (e.g. "submitted")', () => {
    expect(parser.parse({ requestId: 'req-3', eventName: 'submitted', direction: 1 })).toEqual([]);
  });
});

describe('Msg91WhatsappProvider', () => {
  it("MSG91's answer → our send result: request id now, WAMID later from the report", () => {
    expect(
      sendResultOf({
        httpStatus: 200,
        skipped: false,
        body: { status: 'success', hasError: false, request_id: 'req-9' },
      }),
    ).toEqual({
      ok: true,
      providerMessageId: null,
      providerRequestId: 'req-9',
    });
    expect(
      sendResultOf({
        httpStatus: 200,
        skipped: false,
        body: {
          status: 'success',
          hasError: false,
          request_id: 'req-9',
          data: [{ id: 'wamid.X1' }],
        },
      }),
    ).toMatchObject({ ok: true, providerMessageId: 'wamid.X1', providerRequestId: 'req-9' });
    expect(sendResultOf({ httpStatus: 429, skipped: false, body: null })).toMatchObject({
      ok: false,
      errorCode: 'rate_limited',
      retryable: true,
    });
    expect(sendResultOf({ httpStatus: 401, skipped: false, body: null })).toMatchObject({
      ok: false,
      errorCode: 'token_invalid',
      retryable: false,
    });
    expect(
      sendResultOf({
        httpStatus: 200,
        skipped: false,
        body: { status: 'fail', hasError: true, errors: 'template not found' },
      }),
    ).toMatchObject({
      ok: false,
      errorCode: 'unknown',
      retryable: false,
    });
    expect(sendResultOf({ httpStatus: 0, skipped: true, body: null })).toMatchObject({
      ok: false,
      errorCode: 'recipient_not_allowed',
    });
  });

  it('sends templates and session messages through the MSG91 client (one recipient per request)', async () => {
    const calls: unknown[] = [];
    const ok = {
      httpStatus: 200,
      skipped: false,
      body: { status: 'success', hasError: false, request_id: 'req-1' },
    };
    const provider = new Msg91WhatsappProvider({
      postWhatsappTemplate: async (...args: unknown[]) => {
        calls.push(['template', ...args]);
        return ok;
      },
      postWhatsappSession: async (...args: unknown[]) => {
        calls.push(['session', ...args]);
        return ok;
      },
    } as never);
    await provider.sendTemplate('919876543210', {
      templateName: 'ls_new_load_rate_v1',
      languageCode: 'en',
      bodyVariables: ['Delhi', 'Jaipur'],
    });
    await provider.sendList('919876543210', {
      bodyText: 'Which load is "42k" for?',
      buttonText: 'Choose load',
      sectionTitle: 'Your open loads',
      rows: [{ id: 'load:LOAD-0042', title: 'LOAD-0042' }],
    });
    expect(calls[0]).toEqual([
      'template',
      '919876543210',
      'ls_new_load_rate_v1',
      ['Delhi', 'Jaipur'],
      'en',
      {},
    ]);
    expect(calls[1]).toMatchObject([
      'session',
      '919876543210',
      {
        contentType: 'interactive',
        interactive: {
          type: 'list',
          action: { button: 'Choose load', sections: [{ rows: [{ id: 'load:LOAD-0042' }] }] },
        },
      },
    ]);
  });

  it('a network failure is retryable', async () => {
    const provider = new Msg91WhatsappProvider({
      postWhatsappTemplate: async () => {
        throw new Error('ECONNRESET');
      },
      postWhatsappSession: async () => {
        throw new Error('ECONNRESET');
      },
    } as never);
    expect(await provider.sendText('919876543210', 'hi')).toMatchObject({
      ok: false,
      errorCode: 'network',
      retryable: true,
    });
  });
});

describe('MSG91 template extras', () => {
  it('passes a document header and URL-button values to the client', async () => {
    const calls: unknown[][] = [];
    const provider = new Msg91WhatsappProvider({
      postWhatsappTemplate: async (...args: unknown[]) => {
        calls.push(args);
        return { httpStatus: 200, skipped: false, body: { status: 'success', hasError: false } };
      },
      postWhatsappSession: async () => ({ httpStatus: 200, skipped: false, body: null }),
    } as never);
    await provider.sendTemplate('919876543210', {
      templateName: 'ls_n_0112',
      languageCode: 'en',
      bodyVariables: ['LS-1'],
      headerDocument: { link: 'https://files.example/proof.pdf', filename: 'LS-1 proof.pdf' },
      urlButtons: [{ position: 2, value: 'load-uuid' }],
    });
    expect(calls[0][4]).toEqual({
      headerDocument: { link: 'https://files.example/proof.pdf', filename: 'LS-1 proof.pdf' },
      urlButtons: [{ position: 2, value: 'load-uuid' }],
    });
  });

  it('builds header_1 (document) and button_N (url) slots', () => {
    expect(
      templateExtraComponents({
        headerDocument: { link: 'https://files.example/proof.pdf', filename: 'proof.pdf' },
        urlButtons: [{ position: 2, value: 'load-uuid' }],
      }),
    ).toEqual({
      header_1: {
        type: 'document',
        value: 'https://files.example/proof.pdf',
        filename: 'proof.pdf',
      },
      button_2: { subtype: 'url', type: 'text', value: 'load-uuid' },
    });
    expect(templateExtraComponents({})).toEqual({});
  });
});
