/**
 * Local end-to-end check of the MSG91 WhatsApp webhook (webhook → store → queue → worker → status)
 * against the real local Postgres + Redis, without starting the full server (no crons, no sends).
 * Payloads follow MSG91 "How to Receive WhatsApp Delivery Reports via Webhook (New)"
 * (direction 0 = inbound / 1 = report, customerNumber, uuid = WAMID, requestId, eventName,
 * replyMsgId, stringified `button`).
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/messaging-part2-smoke.ts
 * While a dev server is running, isolate the queues: REDIS_URL=redis://localhost:6379/14 npx ts-node …
 * Cleans up its own rows (provider_message_id LIKE 'wamid.SMOKE%').
 */
import express from 'express';
import { AppDataSource } from '../src/db/data-source';
import { redisManager } from '../src/db/redis';
import { createJobQueue, closeAllQueues } from '../src/jobs/queue-registry';
import { closeQueueConnection } from '../src/jobs/queue-connection';
import { Msg91WebhookParser } from '../src/modules/messaging/providers/msg91/msg91-webhook.parser';
import { MessageLogRepository } from '../src/modules/messaging/repositories/message-log.repository';
import { WhatsappInboundRepository } from '../src/modules/messaging/repositories/whatsapp-inbound.repository';
import {
  InboundPipelineService,
  routerNotWiredHandler,
} from '../src/modules/messaging/inbound/inbound-pipeline.service';
import { RedisSenderLock } from '../src/modules/messaging/inbound/redis-sender-lock';
import { WhatsappWebhookController } from '../src/modules/messaging/whatsapp-webhook.controller';
import { createWhatsappWebhookRoutes } from '../src/modules/messaging/messaging.routes';
import { createWhatsappInboundWorker } from '../src/modules/messaging/workers/whatsapp-inbound.worker';
import { MESSAGING_QUEUES } from '../src/modules/messaging/messaging.constants';
import { MessageLogEntity } from '../src/modules/messaging/entities/message-log.entity';
import { WhatsappInboundEntity } from '../src/modules/messaging/entities/whatsapp-inbound.entity';

const TOKEN = 'smoke-webhook-token';
const PORT = 5099;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const inboundText = (uuid: string, customerNumber: string, text: string, second: number) => ({
  customerNumber,
  uuid,
  direction: 0,
  contentType: 'text',
  text,
  replyMsgId: '',
  ts: String(1794571100 + second),
});

async function post(body: unknown, token = TOKEN): Promise<number> {
  const response = await fetch(
    `http://localhost:${PORT}/v1/webhooks/msg91/whatsapp?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return response.status;
}

async function main() {
  await AppDataSource.initialize();
  await redisManager.connect();
  const inboundRepository = AppDataSource.getRepository(WhatsappInboundEntity);
  const messageLogRepository = AppDataSource.getRepository(MessageLogEntity);
  const cleanup = async () => {
    await inboundRepository
      .createQueryBuilder()
      .delete()
      .where('provider_message_id LIKE :prefix', { prefix: 'wamid.SMOKE%' })
      .execute();
    await messageLogRepository
      .createQueryBuilder()
      .delete()
      .where('provider_request_id = :requestId OR provider_message_id LIKE :prefix', {
        requestId: 'req-SMOKE',
        prefix: 'wamid.SMOKE%',
      })
      .execute();
  };
  await cleanup();

  const pipeline = new InboundPipelineService(
    new WhatsappInboundRepository(AppDataSource),
    new MessageLogRepository(AppDataSource),
    createJobQueue(MESSAGING_QUEUES.inbound),
    new RedisSenderLock(redisManager),
    routerNotWiredHandler,
  );
  const worker = createWhatsappInboundWorker(pipeline);
  const controller = new WhatsappWebhookController(
    new Msg91WebhookParser({ token: TOKEN }),
    pipeline,
  );
  const listenerBodies: unknown[] = [];
  controller.addBodyListener(async (body) => {
    listenerBodies.push(body);
  });
  const app = express();
  app.use(express.json());
  app.use('/v1', createWhatsappWebhookRoutes(controller));
  const server = app.listen(PORT);

  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = '') => results.push([name, ok, detail]);

  check(
    'POST with wrong token → 401',
    (await post(inboundText('wamid.SMOKE.0', '919000000001', 'x', 0), 'wrong')) === 401,
  );
  check(
    'POST with token → 200',
    (await post(inboundText('wamid.SMOKE.1', '919000000001', '47k', 1))) === 200,
  );
  check(
    'same message again → 200 (dedupe)',
    (await post(inboundText('wamid.SMOKE.1', '919000000001', '47k', 1))) === 200,
  );
  await post(inboundText('wamid.SMOKE.2', '919000000002', 'other user', 2));
  await post({
    customerNumber: '919000000001',
    uuid: 'wamid.SMOKE.3',
    direction: 0,
    contentType: 'button',
    button: JSON.stringify({ payload: 'Negotiate', text: 'Negotiate' }),
    replyMsgId: 'wamid.SMOKE.OUT',
    ts: '1794571103',
  });

  // An offer we sent: MSG91 gave only a request id; the WAMID comes with the first report.
  await messageLogRepository.save(
    messageLogRepository.create({
      recipientKind: 'partner',
      address: '919000000001',
      channel: 'whatsapp',
      provider: 'msg91',
      kind: 'offer',
      providerRequestId: 'req-SMOKE',
      providerMessageId: null,
      status: 'submitted',
    }),
  );
  await post({
    requestId: 'req-SMOKE',
    uuid: 'wamid.SMOKE.OUT',
    eventName: 'read',
    direction: 1,
    customerNumber: '919000000001',
    ts: 1794571200,
  });
  await post({
    requestId: 'req-SMOKE',
    uuid: 'wamid.SMOKE.OUT',
    eventName: 'sent',
    direction: 1,
    customerNumber: '919000000001',
    ts: 1794571150,
  });

  await sleep(4000);
  const rows = await inboundRepository
    .createQueryBuilder('inbound')
    .where('inbound.providerMessageId LIKE :prefix', { prefix: 'wamid.SMOKE%' })
    .orderBy('inbound.receivedAt', 'ASC')
    .getMany();
  check(
    '3 inbound rows stored (wrong token + duplicate not stored)',
    rows.length === 3,
    `${rows.length} rows`,
  );
  check(
    'all handled by the worker (not pending)',
    rows.every((row) => row.resolution !== 'pending'),
    rows.map((row) => row.resolution).join(','),
  );
  const tap = rows.find((row) => row.providerMessageId === 'wamid.SMOKE.3');
  check(
    'template tap: button text + replyMsgId kept',
    tap?.type === 'button' &&
      tap.buttonText === 'Negotiate' &&
      tap.contextMessageId === 'wamid.SMOKE.OUT',
    `${tap?.type} ${tap?.buttonText} ${tap?.contextMessageId}`,
  );
  const outbound = await messageLogRepository.findOne({
    where: { providerRequestId: 'req-SMOKE' },
  });
  check(
    'WAMID filled from the report by request id; read applied (delivered filled), late sent ignored',
    outbound?.providerMessageId === 'wamid.SMOKE.OUT' &&
      outbound?.status === 'read' &&
      Boolean(outbound?.deliveredAt),
    `${outbound?.providerMessageId} ${outbound?.status}`,
  );
  check(
    'every authenticated body reaches the other listener (driver-invite reports)',
    listenerBodies.length === 6,
    String(listenerBodies.length),
  );

  for (const [name, ok, detail] of results)
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);

  await cleanup();
  server.close();
  await worker.close();
  await closeAllQueues();
  await closeQueueConnection();
  await redisManager.close();
  await AppDataSource.destroy();
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
