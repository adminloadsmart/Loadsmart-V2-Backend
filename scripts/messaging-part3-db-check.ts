/**
 * Checks the router's DB lookups (findAwaitingPick, findFirstDecision) on the local Postgres.
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/messaging-part3-db-check.ts
 * Cleans up its own rows (provider_message_id LIKE 'wamid.P3CHECK%').
 */
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/db/data-source';
import { WhatsappInboundEntity } from '../src/modules/messaging/entities/whatsapp-inbound.entity';
import { WhatsappInboundRepository } from '../src/modules/messaging/repositories/whatsapp-inbound.repository';

async function main() {
  await AppDataSource.initialize();
  const rows = AppDataSource.getRepository(WhatsappInboundEntity);
  const repository = new WhatsappInboundRepository(AppDataSource);
  const cleanup = () =>
    rows
      .createQueryBuilder()
      .delete()
      .where('provider_message_id LIKE :prefix', { prefix: 'wamid.P3CHECK%' })
      .execute();
  await cleanup();

  const offerLogId = randomUUID();
  const pickerLogId = randomUUID();
  const base = {
    provider: 'msg91' as const,
    fromPhone: '919000000001',
    providerType: 'interactive',
    raw: {},
  };
  const insert = (fields: Partial<WhatsappInboundEntity>) =>
    rows.save(rows.create({ ...base, ...fields }));
  const firstTap = await insert({
    providerMessageId: 'wamid.P3CHECK.1',
    type: 'button',
    buttonId: 'negotiate:LS-1:p',
    matchedMessageLogId: offerLogId,
    resolution: 'negotiating',
    receivedAt: new Date(1000),
  });
  await insert({
    providerMessageId: 'wamid.P3CHECK.2',
    type: 'button',
    buttonId: 'accept:LS-1:p',
    matchedMessageLogId: offerLogId,
    resolution: 'changed_answer',
    receivedAt: new Date(2000),
  });
  const waiting = await insert({
    providerMessageId: 'wamid.P3CHECK.3',
    type: 'text',
    body: '37k',
    pickerMessageLogId: pickerLogId,
    resolution: 'awaiting_load_pick',
    receivedAt: new Date(3000),
  });
  const current = await insert({
    providerMessageId: 'wamid.P3CHECK.4',
    type: 'button',
    buttonId: 'accept:LS-1:p',
    matchedMessageLogId: offerLogId,
    resolution: 'pending',
    receivedAt: new Date(4000),
  });

  const firstDecision = await repository.findFirstDecision(offerLogId, current.id);
  const firstDecisionExcludingItself = await repository.findFirstDecision(offerLogId, firstTap.id);
  const awaiting = await repository.findAwaitingPick(pickerLogId);
  const checks: [string, boolean][] = [
    ['findFirstDecision returns the first decisive tap', firstDecision?.id === firstTap.id],
    [
      'findFirstDecision skips changed_answer rows and the current row',
      firstDecisionExcludingItself === null,
    ],
    ['findAwaitingPick finds the row waiting on the picker', awaiting?.id === waiting.id],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? '✅' : '❌'} ${name}`);
  await cleanup();
  await AppDataSource.destroy();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
