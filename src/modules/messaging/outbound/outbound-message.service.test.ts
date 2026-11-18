import { beforeEach, describe, expect, it } from 'vitest';
import { MessageLogEntity } from '../entities/message-log.entity';
import { EnqueueOptions, JobQueue } from '../../../jobs/queue-registry';
import { SendResult, WhatsappProvider } from '../providers/whatsapp-provider.interface';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { orderTemplateVariables } from '../templates/template-registry';
import {
  ContactConsent,
  OutboundJobPayload,
  OutboundMessageService,
  OutboundMessageStore,
  RetryableSendError,
} from './outbound-message.service';
import { WhatsappReplySender } from './whatsapp-reply-sender';

const PHONE = '919000000001';
const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0, 0));
const HOUR_MS = 60 * 60 * 1000;

class FakeStore implements OutboundMessageStore {
  logs: MessageLogEntity[] = [];
  lastInboundAt: Date | null = null;
  async createMessageLog(row: Partial<MessageLogEntity>) {
    const log = { id: `log-${this.logs.length + 1}`, ...row } as MessageLogEntity;
    this.logs.push(log);
    return log;
  }
  async updateMessageLog(messageLogId: string, patch: MessageLogPatch) {
    Object.assign(
      this.logs.find((log) => log.id === messageLogId)!,
      patch,
    );
  }
  async latestInboundAt() {
    return this.lastInboundAt;
  }
  async findInboundProviderMessageId(inboundId: string) {
    return `wamid.${inboundId}`;
  }
}

class FakeQueue implements JobQueue {
  jobs: { payload: OutboundJobPayload; options?: EnqueueOptions }[] = [];
  async enqueue(_name: string, payload: unknown, options?: EnqueueOptions) {
    this.jobs.push({ payload: payload as OutboundJobPayload, options });
  }
  async cancel() {}
  async upsertSchedule() {}
}

function fakeProvider(result: SendResult): WhatsappProvider & { calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
    return result;
  };
  return {
    name: 'msg91',
    capabilities: {
      sessionButtons: true,
      sessionLists: true,
      templateButtonPayload: true,
      replyContext: true,
    },
    sendTemplate: record('template'),
    sendText: record('text'),
    sendButtons: record('buttons'),
    sendList: record('list'),
    fetchMedia: async () => ({ bytes: Buffer.alloc(0), mimeType: null }),
    calls,
  };
}

const optedIn: ContactConsent = { hasWhatsappOptIn: async () => true };
let store: FakeStore;
let queue: FakeQueue;

function service(
  provider: WhatsappProvider | null = fakeProvider({
    ok: true,
    providerMessageId: 'wamid.OUT',
    providerRequestId: null,
  }),
  templateNames: Record<string, string> = {
    LS_N_0105: 'ls_new_load_rate_v1',
    LS_N_0107: 'ls_rate_accepted_v1',
  },
  consent = optedIn,
) {
  return new OutboundMessageService(store, queue, consent, {
    provider,
    providerName: 'msg91',
    templateNames,
    templateLanguage: 'en',
    now: () => NOW,
  });
}

const recipient = {
  kind: 'partner' as const,
  refId: 'partner_A',
  name: 'Sharma ji',
  phone: '+91 90000 00001',
};
const loadFields = { tenantId: null, loadId: 'load-uuid', loadRef: 'LS-2001', actor: 'test' };
const requirementVars = {
  from_area: 'Delhi 110037',
  to_area: 'Jaipur',
  truck_type: '32 ft',
  weight: '18',
  reporting_time: '15 Nov, 10:00 am',
  rate: '45,000',
};

beforeEach(() => {
  store = new FakeStore();
  queue = new FakeQueue();
});

describe('template registry', () => {
  it('orders variables and refuses a missing one', () => {
    expect(orderTemplateVariables('LS_N_0117', { load_id: 'LS-1' })).toEqual(['LS-1']);
    expect(() => orderTemplateVariables('LS_N_0105', { from_area: 'Delhi' })).toThrow(/to_area/);
  });
});

describe('OutboundMessageService', () => {
  it('logs then queues a template with one payload per offer button', async () => {
    const result = await service().sendTemplate({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
    });
    expect(result).toEqual({ messageLogId: 'log-1', status: 'queued' });
    expect(store.logs[0]).toMatchObject({
      kind: 'offer',
      templateKey: 'LS_N_0105',
      loadRef: 'LS-2001',
      recipientRefId: 'partner_A',
      address: '919000000001',
      status: 'queued',
      renderedText:
        'New load from Loadsmart: Delhi 110037 to Jaipur, 32 ft, 18 t, reporting 15 Nov, 10:00 am. Rate ₹45,000. Are you interested?',
    });
    expect(queue.jobs[0].payload.content).toMatchObject({
      type: 'template',
      templateName: 'ls_new_load_rate_v1',
      bodyVariables: ['Delhi 110037', 'Jaipur', '32 ft', '18', '15 Nov, 10:00 am', '45,000'],
      quickReplyPayloads: [
        'accept:LS-2001:partner_A',
        'negotiate:LS-2001:partner_A',
        'reject:LS-2001:partner_A',
      ],
    });
    expect(queue.jobs[0].options?.jobId).toBe('log-1');
  });

  it('carries a dynamic URL button value and a document header to the provider', async () => {
    await service(undefined, { LS_N_0110: 'ls_n_0110', LS_N_0112: 'ls_n_0112' }).sendTemplate({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0110',
      variables: {
        load_id: 'LS-2001',
        from_area: 'Delhi',
        to_area: 'Jaipur',
        vehicle_no: 'PB10AB1234',
        reporting_time: '15 Nov, 10:00 am',
        driver_name: 'Ramesh',
        load_uuid: 'load-uuid',
      },
    });
    expect(queue.jobs[0].payload.content).toMatchObject({
      type: 'template',
      bodyVariables: ['LS-2001', 'Delhi', 'Jaipur', 'PB10AB1234', '15 Nov, 10:00 am', 'Ramesh'],
      urlButtons: [{ position: 1, value: 'load-uuid' }],
    });
    expect(store.logs[0]).toMatchObject({ kind: 'template', templateKey: 'LS_N_0110' });
  });

  it('keeps WhatsApp off for a driver on the driver app (channel rules)', async () => {
    const result = await service(undefined, { LS_N_0130: 'ls_n_0130' }).sendTemplate({
      ...loadFields,
      recipient: { kind: 'driver', refId: 'driver-1', name: 'Ramesh', phone: '9000000002' },
      templateKey: 'LS_N_0130',
      variables: {
        vehicle_no: 'PB10AB1234',
        destination: 'Ludhiana',
        destination_query: '30.9,75.8',
      },
      driverHasApp: true,
    });
    expect(result).toMatchObject({ status: 'suppressed', suppressedReason: 'driver_uses_app' });
    expect(queue.jobs).toHaveLength(0);
  });

  it('suppresses a template that is not configured yet', async () => {
    const result = await service(undefined, {}).sendTemplate({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
    });
    expect(result).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'template_not_configured',
    });
    expect(queue.jobs).toHaveLength(0);
  });

  it('suppresses without opt-in', async () => {
    const result = await service(undefined, undefined, {
      hasWhatsappOptIn: async () => false,
    }).sendTemplate({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
    });
    expect(result).toMatchObject({ status: 'suppressed', suppressedReason: 'no_opt_in' });
  });

  it('sends a session message inside the 24-h window, quoting the inbound it answers', async () => {
    store.lastInboundAt = new Date(NOW.getTime() - HOUR_MS);
    await service().sendSession({
      ...loadFields,
      recipient,
      kind: 'rate_request',
      content: { type: 'text', text: 'rate?' },
      replyToInboundId: 'in-7',
    });
    expect(queue.jobs[0].payload).toMatchObject({
      content: { type: 'text' },
      replyToProviderMessageId: 'wamid.in-7',
    });
    expect(store.logs[0]).toMatchObject({
      kind: 'rate_request',
      replyToInboundId: 'in-7',
      renderedText: 'rate?',
    });
  });

  it('falls back to the template once the window has closed (G1), else suppresses', async () => {
    store.lastInboundAt = new Date(NOW.getTime() - 25 * HOUR_MS);
    const withFallback = await service().sendSession({
      ...loadFields,
      recipient,
      kind: 'dispatch_request',
      content: { type: 'text', text: 'details?' },
      fallbackTemplate: {
        templateKey: 'LS_N_0107',
        variables: { rate: '45,000', from_area: 'Delhi 110037', to_area: 'Jaipur' },
      },
    });
    expect(withFallback.status).toBe('queued');
    expect(store.logs[0]).toMatchObject({ kind: 'template', templateKey: 'LS_N_0107' });
    const withoutFallback = await service().sendSession({
      ...loadFields,
      recipient,
      kind: 'rate_request',
      content: { type: 'text', text: 'rate?' },
    });
    expect(withoutFallback).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'window_closed_no_template',
    });
  });

  it('sends an offer as session buttons with the same ids while its template is not configured (testing)', async () => {
    store.lastInboundAt = new Date(NOW.getTime() - HOUR_MS);
    await service(undefined, {}).sendOffer({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
      sessionBodyText: 'Delhi → Jaipur ₹45,000',
    });
    expect(queue.jobs[0].payload.content).toMatchObject({
      type: 'buttons',
      message: {
        buttons: [
          { id: 'accept:LS-2001:partner_A' },
          { id: 'negotiate:LS-2001:partner_A' },
          { id: 'reject:LS-2001:partner_A' },
        ],
      },
    });
    expect(store.logs[0].kind).toBe('offer');
  });
});

describe('OutboundMessageService.deliver', () => {
  async function queuedPayload(provider: WhatsappProvider | null) {
    const outbound = service(provider);
    await outbound.sendTemplate({
      ...loadFields,
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
    });
    return { outbound, payload: queue.jobs[0].payload };
  }

  it('records the WAMID on success', async () => {
    const { outbound, payload } = await queuedPayload(
      fakeProvider({ ok: true, providerMessageId: 'wamid.SENT', providerRequestId: null }),
    );
    await outbound.deliver(payload, false);
    expect(store.logs[0]).toMatchObject({ status: 'submitted', providerMessageId: 'wamid.SENT' });
  });

  it('retries retryable failures, and records them on the last attempt', async () => {
    const { outbound, payload } = await queuedPayload(
      fakeProvider({ ok: false, errorCode: 'rate_limited', retryable: true, detail: '130429' }),
    );
    await expect(outbound.deliver(payload, false)).rejects.toBeInstanceOf(RetryableSendError);
    expect(store.logs[0].status).toBe('queued');
    await outbound.deliver(payload, true);
    expect(store.logs[0]).toMatchObject({ status: 'failed', error: { code: 'rate_limited' } });
  });

  it('records permanent failures at once', async () => {
    const { outbound, payload } = await queuedPayload(
      fakeProvider({ ok: false, errorCode: 'window_closed', retryable: false, detail: '131047' }),
    );
    await outbound.deliver(payload, false);
    expect(store.logs[0]).toMatchObject({ status: 'failed', error: { code: 'window_closed' } });
  });

  it('suppresses when no provider is configured', async () => {
    const { outbound, payload } = await queuedPayload(null);
    await outbound.deliver(payload, false);
    expect(store.logs[0]).toMatchObject({
      status: 'suppressed',
      suppressedReason: 'provider_not_configured',
    });
  });
});

describe('WhatsappReplySender', () => {
  const context = {
    tenantId: null,
    loadId: 'load-uuid',
    loadRef: 'LS-2004',
    recipientKind: 'partner' as const,
    recipientRefId: 'partner_B',
    messageLogId: null,
  };
  const sender = { phone: PHONE, userId: null };

  beforeEach(() => {
    store.lastInboundAt = new Date(NOW.getTime() - HOUR_MS);
  });

  it('sends a picker with load-row ids and returns its message_log id', async () => {
    const replySender = new WhatsappReplySender(service());
    const candidates = ['LS-2002', 'LS-2004'].map((loadRef) => ({
      ...context,
      loadRef,
      stage: 'awaiting_rate' as const,
      laneLabel: 'Gurugram 122001 → Ludhiana · 20 ft open',
    }));
    expect(
      await replySender.sendLoadPicker(
        sender,
        candidates,
        'Aapka "37k" kis load ke liye hai?',
        'in-1',
      ),
    ).toBe('log-1');
    expect(queue.jobs[0].payload.content).toMatchObject({
      type: 'list',
      message: { rows: [{ id: 'load:LS-2002', title: 'LS-2002' }, { id: 'load:LS-2004' }] },
    });
    expect(store.logs[0].kind).toBe('picker');
  });

  it('asks its question as a text quoting the reply', async () => {
    await new WhatsappReplySender(service()).sendPrompt(
      context,
      sender,
      'dispatch_request',
      'in-2',
    );
    expect(queue.jobs[0].payload.content).toMatchObject({ type: 'text' });
    expect(store.logs[0]).toMatchObject({
      kind: 'dispatch_request',
      loadRef: 'LS-2004',
      recipientRefId: 'partner_B',
    });
  });
});

describe('OutboundMessageService — channel rules', () => {
  it('no WhatsApp to a shipper user about a load before its memo; transporters unaffected', async () => {
    const outbound = new OutboundMessageService(store, queue, optedIn, {
      provider: fakeProvider({ ok: true, providerMessageId: 'wamid.OUT', providerRequestId: null }),
      providerName: 'msg91',
      templateNames: { LS_N_0069: 'ls_memo_v1', LS_N_0105: 'ls_new_load_rate_v1' },
      templateLanguage: 'en',
      now: () => NOW,
      loadFacts: { forLoad: async () => ({ hasMemoStep: true, memoSent: false }) },
    });
    const shipper = await outbound.sendTemplate({
      ...loadFields,
      tenantId: 'tenant-1',
      recipient: { kind: 'shipper_user', refId: 'user-1', name: 'Anita', phone: '9876543210' },
      templateKey: 'LS_N_0069',
      variables: {
        vehicle_no: 'PB10AB1234',
        driver_name: 'Ramesh',
        price: '45,000',
        origin: 'Delhi',
        destination: 'Jaipur',
        expiry_time: '11:00 am',
      },
    });
    expect(shipper).toMatchObject({ status: 'suppressed', suppressedReason: 'before_load_memo' });
    const transporter = await outbound.sendTemplate({
      ...loadFields,
      tenantId: 'tenant-1',
      recipient,
      templateKey: 'LS_N_0105',
      variables: requirementVars,
    });
    expect(transporter.status).toBe('queued');
  });

  it("Loadsmart's bid (LS_N_0067) and bids received (LS_N_0103) still reach the shipper before the memo", async () => {
    const outbound = new OutboundMessageService(store, queue, optedIn, {
      provider: fakeProvider({ ok: true, providerMessageId: 'wamid.OUT', providerRequestId: null }),
      providerName: 'msg91',
      templateNames: { LS_N_0067: 'ls_n_0067', LS_N_0103: 'ls_n_0103' },
      templateLanguage: 'en',
      now: () => NOW,
      loadFacts: { forLoad: async () => ({ hasMemoStep: true, memoSent: false }) },
    });
    const shipper = {
      kind: 'shipper_user' as const,
      refId: 'user-1',
      name: 'Anita',
      phone: '9876543210',
    };
    const bid = await outbound.sendTemplate({
      ...loadFields,
      tenantId: 'tenant-1',
      recipient: shipper,
      templateKey: 'LS_N_0067',
      variables: {
        origin: 'Delhi',
        destination: 'Jaipur',
        truck_type: '32 ft',
        reporting_time: '15 Nov, 10:00 am',
        price: '47,500',
      },
    });
    const bids = await outbound.sendTemplate({
      ...loadFields,
      tenantId: 'tenant-1',
      recipient: shipper,
      templateKey: 'LS_N_0103',
      variables: { origin: 'Delhi', destination: 'Jaipur', bid_count: '2', best_rate: '41,000' },
    });
    expect([bid.status, bids.status]).toEqual(['queued', 'queued']);
  });
});
