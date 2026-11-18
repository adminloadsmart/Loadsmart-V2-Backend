import { describe, expect, it } from 'vitest';
import { MessageLogEntity } from '../entities/message-log.entity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogQueryService } from './message-log-query.service';
import { MessageLogNotificationSentLog } from './notification-sent-log';

const at = new Date('2026-11-14T10:00:00Z');
const row = (overrides: Partial<MessageLogEntity>): MessageLogEntity =>
  ({
    id: 'log-x',
    tenantId: 'tenant-1',
    loadId: 'load-1',
    recipientKind: 'shipper_user',
    recipientRefId: 'user-1',
    recipientName: 'Anita',
    address: '9876543210',
    channel: 'whatsapp',
    provider: 'msg91',
    kind: 'offer',
    templateKey: 'ls_requirement',
    renderedText: null,
    intent: 'action',
    status: 'submitted',
    suppressedReason: null,
    providerMessageId: 'wamid.1',
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    error: null,
    actor: 'system',
    createdAt: at,
    ...overrides,
  }) as MessageLogEntity;

const rows = [
  row({
    id: 'log-shipper',
    channel: 'in_app',
    provider: null,
    renderedText: 'LOAD-0042: Invoice generated — …',
  }),
  row({
    id: 'log-transporter',
    recipientKind: 'transporter',
    recipientName: 'Sharma Roadways',
    sentAt: at,
    deliveredAt: at,
  }),
  row({
    id: 'log-partner',
    recipientKind: 'partner',
    recipientName: 'Partner Co',
    address: '9000000001',
  }),
  row({
    id: 'log-receiver',
    recipientKind: 'receiver',
    recipientName: 'Receiver',
    channel: 'sms',
    provider: null,
  }),
];
const replies = [
  {
    id: 'in-1',
    matchedMessageLogId: 'log-transporter',
    fromPhone: '919876543210',
    type: 'button',
    buttonText: 'Accept',
    body: null,
    listRowId: null,
    buttonId: 'accept:LOAD-0042:r1',
    receivedAt: at,
    routingMethod: 'context_id',
    resolution: 'accepted',
    resolutionNote: null,
    parsedValues: null,
  },
  {
    id: 'in-2',
    matchedMessageLogId: null,
    fromPhone: '919876543210',
    type: 'text',
    buttonText: null,
    body: '42k',
    listRowId: null,
    buttonId: null,
    receivedAt: at,
    routingMethod: 'only_pending',
    resolution: 'bid_recorded',
    resolutionNote: null,
    parsedValues: null,
  },
] as unknown as WhatsappInboundEntity[];

function service(route: string | null) {
  return new MessageLogQueryService(
    {
      listMessagesForLoad: async () => rows,
      listRepliesForLoad: async () => replies,
    },
    {
      findLoad: async (loadId, tenantId) =>
        tenantId === 'other-tenant' ? null : { id: loadId, tenantId: 'tenant-1', route },
    },
  );
}

describe('MessageLogQueryService', () => {
  it('shipper view: own team, receivers and own transporters; never partners, phones or providers', async () => {
    const view = await service('own_transporter').shipperView('tenant-1', 'load-1');
    expect(view.map((item) => item.recipient)).toEqual(['Anita', 'Sharma Roadways', 'Receiver']);
    expect(JSON.stringify(view)).not.toMatch(/9876543210|9000000001|meta|wamid/);
  });

  it('shipper view on a Loadsmart load hides the brokers entirely', async () => {
    const view = await service('loadsmart').shipperView('tenant-1', 'load-1');
    expect(view.map((item) => item.recipientKind)).toEqual(['shipper_user', 'receiver']);
  });

  it("another tenant's load is not found", async () => {
    await expect(service('own_transporter').shipperView('other-tenant', 'load-1')).rejects.toThrow(
      /not found/,
    );
  });

  it('admin view keeps everything', async () => {
    const view = await service('loadsmart').adminView('load-1');
    expect(view.map((item) => item.id)).toEqual([
      'log-shipper',
      'log-transporter',
      'log-partner',
      'log-receiver',
    ]);
    expect(view[1]).toMatchObject({ provider: 'msg91', address: '9876543210' });
  });

  it('WhatsApp log: messages with status times and their replies; unmatched replies apart', async () => {
    const view = await service('own_transporter').whatsappView('load-1');
    expect(view.messages.map((message) => message.id)).toEqual(['log-transporter', 'log-partner']);
    expect(view.messages[0]).toMatchObject({
      template: 'ls_requirement',
      deliveredAt: at.toISOString(),
      replies: [{ id: 'in-1', text: 'Accept', resolution: 'accepted' }],
    });
    expect(view.otherReplies).toEqual([expect.objectContaining({ id: 'in-2', text: '42k' })]);
  });
});

describe('MessageLogNotificationSentLog', () => {
  it('writes one message_log row per channel, suppressed ones with their reason', async () => {
    const written: Partial<MessageLogEntity>[] = [];
    await new MessageLogNotificationSentLog({
      createMany: async (items) => void written.push(...items),
    }).record([
      {
        tenantId: 't',
        loadId: 'l',
        type: 'load.delivery_late',
        intent: 'update',
        recipient: { id: 'u', name: 'Asha' },
        channel: 'whatsapp',
        address: '98',
        status: 'suppressed',
        suppressedReason: 'update_app_only',
        title: 'Late',
        body: 'ETA 6 pm',
      },
      {
        tenantId: 't',
        loadId: 'l',
        type: 'load.delivery_late',
        intent: 'update',
        recipient: { id: 'u', name: 'Asha' },
        channel: 'in_app',
        address: 'app',
        status: 'queued',
        title: 'Late',
        body: 'ETA 6 pm',
      },
    ]);
    expect(written).toEqual([
      expect.objectContaining({
        channel: 'whatsapp',
        status: 'suppressed',
        suppressedReason: 'update_app_only',
        recipientKind: 'shipper_user',
        templateKey: 'load.delivery_late',
        renderedText: 'Late — ETA 6 pm',
      }),
      expect.objectContaining({ channel: 'in_app', status: 'queued', suppressedReason: null }),
    ]);
  });
});
