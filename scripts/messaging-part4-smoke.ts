/**
 * Local check of messaging Part 4 (outbound): message_log row → BullMQ (limiter) → worker →
 * provider → ids recorded; 24-h window fallback; suppression. Real Postgres + Redis, fake provider
 * (no MSG91 credentials, nothing is sent). Run:
 *   npx ts-node --transpile-only -r reflect-metadata scripts/messaging-part4-smoke.ts
 * While a dev server is running, isolate the queues: REDIS_URL=redis://localhost:6379/14 npx ts-node …
 * Cleans up rows for the test phone 919999999990.
 */
import { AppDataSource } from '../src/db/data-source';
import { redisManager } from '../src/db/redis';
import { createJobQueue, closeAllQueues } from '../src/jobs/queue-registry';
import { closeQueueConnection } from '../src/jobs/queue-connection';
import { MESSAGING_QUEUES } from '../src/modules/messaging/messaging.constants';
import { MessageLogEntity } from '../src/modules/messaging/entities/message-log.entity';
import { WhatsappInboundEntity } from '../src/modules/messaging/entities/whatsapp-inbound.entity';
import { MessageLogRepository } from '../src/modules/messaging/repositories/message-log.repository';
import { WhatsappInboundRepository } from '../src/modules/messaging/repositories/whatsapp-inbound.repository';
import { OutboundMessageService } from '../src/modules/messaging/outbound/outbound-message.service';
import { RepositoryOutboundMessageStore } from '../src/modules/messaging/outbound/outbound-message-store';
import { WhatsappReplySender } from '../src/modules/messaging/outbound/whatsapp-reply-sender';
import { createWhatsappOutboundWorker } from '../src/modules/messaging/workers/whatsapp-outbound.worker';
import {
  SendResult,
  WhatsappProvider,
} from '../src/modules/messaging/providers/whatsapp-provider.interface';

const TEST_PHONE = '919999999990';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await AppDataSource.initialize();
  await redisManager.connect();
  const logs = AppDataSource.getRepository(MessageLogEntity);
  const inbound = AppDataSource.getRepository(WhatsappInboundEntity);
  const cleanup = async () => {
    await logs
      .createQueryBuilder()
      .delete()
      .where('address = :phone', { phone: TEST_PHONE })
      .execute();
    await inbound
      .createQueryBuilder()
      .delete()
      .where('from_phone = :phone', { phone: TEST_PHONE })
      .execute();
  };
  await cleanup();

  const sent: string[] = [];
  let counter = 0;
  const ok = (kind: string) => async (): Promise<SendResult> => {
    sent.push(kind);
    counter += 1;
    return { ok: true, providerMessageId: `wamid.SMOKE4.${counter}`, providerRequestId: null };
  };
  const provider: WhatsappProvider = {
    name: 'msg91',
    capabilities: {
      sessionButtons: true,
      sessionLists: true,
      templateButtonPayload: true,
      replyContext: true,
    },
    sendTemplate: ok('template'),
    sendText: ok('text'),
    sendButtons: ok('buttons'),
    sendList: ok('list'),
    fetchMedia: async () => ({ bytes: Buffer.alloc(0), mimeType: null }),
  };
  const outbound = new OutboundMessageService(
    new RepositoryOutboundMessageStore(
      new MessageLogRepository(AppDataSource),
      new WhatsappInboundRepository(AppDataSource),
    ),
    createJobQueue(MESSAGING_QUEUES.outbound),
    { hasWhatsappOptIn: async () => true },
    {
      provider,
      providerName: 'msg91',
      templateNames: { LS_N_0105: 'ls_new_load_rate_v1' },
      templateLanguage: 'en',
    },
  );
  const worker = createWhatsappOutboundWorker(outbound);
  const replySender = new WhatsappReplySender(outbound);
  const recipient = {
    kind: 'partner' as const,
    refId: 'partner_SMOKE',
    name: 'Smoke',
    phone: TEST_PHONE,
  };
  const loadFields = { tenantId: null, loadId: null, loadRef: 'LS-SMOKE', actor: 'smoke' };
  const checks: [string, boolean, string][] = [];

  // 1) Template offer (no window needed).
  const offer = await outbound.sendTemplate({
    ...loadFields,
    recipient,
    templateKey: 'LS_N_0105',
    variables: {
      from_area: 'Delhi 110037',
      to_area: 'Jaipur',
      truck_type: '32 ft',
      weight: '18',
      reporting_time: '15 Nov, 10:00 am',
      rate: '45,000',
    },
  });
  // 2) Session prompt with the window closed and no fallback → suppressed.
  const closedPrompt = await outbound.sendSession({
    ...loadFields,
    recipient,
    kind: 'rate_request',
    content: { type: 'text', text: 'rate?' },
  });
  // 3) Open the window with an inbound row, then a quoted session prompt + a picker.
  const inboundRow = await inbound.save(
    inbound.create({
      provider: 'msg91',
      providerMessageId: 'wamid.SMOKE4.IN',
      fromPhone: TEST_PHONE,
      type: 'text',
      providerType: 'text',
      body: '37k',
      raw: {},
      receivedAt: new Date(),
    }),
  );
  await replySender.sendPrompt(
    {
      tenantId: null,
      loadId: null,
      loadRef: 'LS-SMOKE',
      recipientKind: 'partner',
      recipientRefId: 'partner_SMOKE',
      messageLogId: null,
    },
    { phone: TEST_PHONE, userId: null },
    'rate_request',
    inboundRow.id,
  );
  const pickerId = await replySender.sendLoadPicker(
    { phone: TEST_PHONE, userId: null },
    [
      {
        tenantId: null,
        loadId: null,
        loadRef: 'LS-SMOKE',
        recipientKind: 'partner',
        recipientRefId: 'partner_SMOKE',
        messageLogId: null,
        stage: 'awaiting_rate',
        laneLabel: 'Delhi → Jaipur',
      },
      {
        tenantId: null,
        loadId: null,
        loadRef: 'LS-SMOKE2',
        recipientKind: 'partner',
        recipientRefId: 'partner_SMOKE',
        messageLogId: null,
        stage: 'awaiting_rate',
        laneLabel: 'Delhi → Ludhiana',
      },
    ],
    'Aapka "37k" kis load ke liye hai?',
    inboundRow.id,
  );

  await sleep(3000);
  const rows = await logs.find({ where: { address: TEST_PHONE }, order: { createdAt: 'ASC' } });
  const offerRow = rows.find((row) => row.id === offer.messageLogId);
  const promptRow = rows.find((row) => row.kind === 'rate_request' && row.status !== 'suppressed');
  checks.push([
    'offer logged then sent by the worker (submitted + WAMID)',
    offerRow?.status === 'submitted' && Boolean(offerRow?.providerMessageId),
    `${offerRow?.status} ${offerRow?.providerMessageId}`,
  ]);
  checks.push([
    'session prompt with closed window → suppressed',
    closedPrompt.status === 'suppressed' &&
      closedPrompt.suppressedReason === 'window_closed_no_template',
    closedPrompt.suppressedReason ?? '',
  ]);
  checks.push([
    'prompt in open window sent, quoting the inbound',
    promptRow?.status === 'submitted' && promptRow?.replyToInboundId === inboundRow.id,
    `${promptRow?.status}`,
  ]);
  checks.push([
    'picker logged with kind picker and sent',
    Boolean(pickerId) &&
      rows.some(
        (row) => row.id === pickerId && row.kind === 'picker' && row.status === 'submitted',
      ),
    String(pickerId),
  ]);
  checks.push([
    'provider received template, text, list',
    ['template', 'text', 'list'].every((kind) => sent.includes(kind)),
    sent.join(','),
  ]);
  for (const [name, passed, detail] of checks)
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);

  await cleanup();
  await worker.close();
  await closeAllQueues();
  await closeQueueConnection();
  await redisManager.close();
  await AppDataSource.destroy();
  process.exit(checks.every(([, passed]) => passed) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
