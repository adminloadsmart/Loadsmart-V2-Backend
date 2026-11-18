/**
 * Local check of tasks 3 + 4 (message log APIs) on real Postgres: inserts test rows for one real
 * load, reads the shipper / admin / WhatsApp views through the real stores, then deletes them.
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/messaging-t3t4-db-check.ts
 */
import { AppDataSource } from '../src/db/data-source';
import { LoadEntity } from '../src/modules/loads/entities/load.entity';
import { MessageLogEntity } from '../src/modules/messaging/entities/message-log.entity';
import { WhatsappInboundEntity } from '../src/modules/messaging/entities/whatsapp-inbound.entity';
import { MessageLogRepository } from '../src/modules/messaging/repositories/message-log.repository';
import { WhatsappInboundRepository } from '../src/modules/messaging/repositories/whatsapp-inbound.repository';
import { MessageLogQueryService } from '../src/modules/messaging/sent-log/message-log-query.service';
import { MessageLogNotificationSentLog } from '../src/modules/messaging/sent-log/notification-sent-log';
import {
  RepositorySentLogStore,
  TypeormSentLogLoadLookup,
} from '../src/modules/messaging/sent-log/sent-log.store';

const ACTOR = 'smoke:t3t4';

async function main() {
  await AppDataSource.initialize();
  const logs = AppDataSource.getRepository(MessageLogEntity);
  const inbound = AppDataSource.getRepository(WhatsappInboundEntity);
  const load = await AppDataSource.getRepository(LoadEntity).findOne({
    where: {},
    order: { createdAt: 'DESC' },
  });
  if (!load) throw new Error('no load in the local DB');
  const cleanup = async () => {
    await inbound
      .createQueryBuilder()
      .delete()
      .where('provider_message_id = :id', { id: 'wamid.T3T4.IN' })
      .execute();
    await logs
      .createQueryBuilder()
      .delete()
      .where('actor IN (:...actors)', { actors: [ACTOR, 'system:notifications'] })
      .andWhere('load_id = :loadId', { loadId: load.id })
      .execute();
  };
  await cleanup();

  const messageLogRepository = new MessageLogRepository(AppDataSource);
  const base = {
    tenantId: load.tenantId,
    loadId: load.id,
    loadRef: load.code,
    actor: ACTOR,
    provider: 'msg91' as const,
    channel: 'whatsapp' as const,
  };
  const toTransporter = await logs.save(
    logs.create({
      ...base,
      recipientKind: 'transporter',
      recipientRefId: 'r-1',
      recipientName: 'Smoke Roadways',
      address: '919999999990',
      kind: 'offer',
      templateKey: 'ls_requirement',
      status: 'submitted',
      providerMessageId: 'wamid.T3T4.OUT',
      sentAt: new Date(),
    }),
  );
  await logs.save(
    logs.create({
      ...base,
      recipientKind: 'partner',
      recipientRefId: 'p-1',
      recipientName: 'Smoke Partner',
      address: '919999999991',
      kind: 'offer',
      templateKey: 'ls_requirement',
      status: 'submitted',
    }),
  );
  await new MessageLogNotificationSentLog(messageLogRepository).record([
    {
      tenantId: load.tenantId,
      loadId: load.id,
      type: 'load.delivery_late',
      intent: 'update',
      recipient: { id: 'u-1', name: 'Smoke Shipper' },
      channel: 'whatsapp',
      address: '9999999992',
      status: 'suppressed',
      suppressedReason: 'update_app_only',
      title: 'Late',
      body: 'ETA 6 pm',
    },
    {
      tenantId: load.tenantId,
      loadId: load.id,
      type: 'load.delivery_late',
      intent: 'update',
      recipient: { id: 'u-1', name: 'Smoke Shipper' },
      channel: 'in_app',
      address: 'app',
      status: 'queued',
      title: 'Late',
      body: 'ETA 6 pm',
    },
  ]);
  await inbound.save(
    inbound.create({
      provider: 'msg91',
      providerMessageId: 'wamid.T3T4.IN',
      fromPhone: '919999999990',
      type: 'button',
      providerType: 'button',
      buttonText: 'Accept',
      raw: {},
      receivedAt: new Date(),
      loadId: load.id,
      matchedMessageLogId: toTransporter.id,
      resolution: 'accepted',
      routingMethod: 'context_id',
    }),
  );

  const query = new MessageLogQueryService(
    new RepositorySentLogStore(messageLogRepository, new WhatsappInboundRepository(AppDataSource)),
    new TypeormSentLogLoadLookup(AppDataSource),
  );
  const shipper = (await query.shipperView(load.tenantId, load.id)).filter(
    (item) => item.recipient.startsWith('Smoke') || item.recipient === 'Loadsmart',
  );
  const admin = (await query.adminView(load.id)).filter((item) =>
    item.recipientName?.startsWith('Smoke'),
  );
  const whatsapp = await query.whatsappView(load.id);
  const smokeMessage = whatsapp.messages.find((message) => message.id === toTransporter.id);
  const checks: [string, boolean, string][] = [
    [
      'shipper view: no partner, no phones / provider',
      !shipper.some((item) => item.recipient === 'Smoke Partner') &&
        !JSON.stringify(shipper).match(/9999999|meta|wamid/),
      `${load.sourceType}: ${shipper.map((item) => `${item.recipient}/${item.channel}/${item.status}`).join(', ')}`,
    ],
    [
      'shipper view: own transporter shown only off Loadsmart loads',
      shipper.some((item) => item.recipient === 'Smoke Roadways') ===
        (load.sourceType !== 'loadsmart'),
      load.sourceType,
    ],
    [
      'admin view: all 4 rows incl. suppressed reason',
      admin.length === 4 && admin.some((item) => item.suppressedReason === 'update_app_only'),
      String(admin.length),
    ],
    [
      'WhatsApp log: reply grouped under its message',
      smokeMessage?.replies.length === 1 && smokeMessage.replies[0].resolution === 'accepted',
      `${smokeMessage?.replies.length}`,
    ],
    [
      "another tenant can't read the load",
      await query.shipperView('00000000-0000-0000-0000-000000000000', load.id).then(
        () => false,
        () => true,
      ),
      '',
    ],
  ];
  for (const [name, passed, detail] of checks)
    console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  await cleanup();
  await AppDataSource.destroy();
  process.exit(checks.every(([, passed]) => passed) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
