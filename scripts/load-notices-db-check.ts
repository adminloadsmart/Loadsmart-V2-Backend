/**
 * Read-only check of the load-notice and shipper-load stores against the local Postgres schema:
 * every query runs (unknown ids → empty results), nothing is written or sent.
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/load-notices-db-check.ts
 */
import { AppDataSource } from '../src/db/data-source';
import { TypeormLoadNoticeStore } from '../src/modules/messaging/integration/load-notice-store';
import { TypeormShipperLoadStore } from '../src/modules/messaging/integration/shipper-reply-actions';
import { LoadEntity } from '../src/modules/loads/entities/load.entity';

const NO_ID = '00000000-0000-4000-8000-000000000000';

async function main() {
  await AppDataSource.initialize();
  const store = new TypeormLoadNoticeStore(AppDataSource);
  const memos = new TypeormShipperLoadStore(AppDataSource);
  const checks: [string, boolean, string][] = [];
  const run = async (name: string, step: () => Promise<unknown>) => {
    try {
      const value = await step();
      checks.push([name, true, Array.isArray(value) ? `${value.length} row(s)` : String(value)]);
    } catch (error) {
      checks.push([name, false, (error as Error).message]);
    }
  };

  const anyLoad = await AppDataSource.getRepository(LoadEntity).findOne({
    where: {},
    order: { createdAt: 'DESC' },
  });
  await run('findLoad (latest load, with its posting)', async () =>
    anyLoad ? Boolean(await store.findLoad(anyLoad.tenantId, anyLoad.id)) : 'no loads',
  );
  await run('findTransporter', () => store.findTransporter(NO_ID, NO_ID));
  await run('findLoadPartner', () => store.findLoadPartner(NO_ID));
  await run('findUser', () => store.findUser(NO_ID));
  await run('shipperName', () => store.shipperName(NO_ID));
  await run('findBid', () => store.findBid(NO_ID, NO_ID));
  await run('findMemo', () => store.findMemo(NO_ID, NO_ID));
  await run('findPartnerPayment', () => store.findPartnerPayment(NO_ID));
  await run('findLoadPayment', () => store.findLoadPayment(NO_ID, NO_ID));
  await run('driverHasApp', () => store.driverHasApp('919000000001'));
  await run('hasSent', () => store.hasSent(NO_ID, 'LS_N_0115', NO_ID, new Date()));
  await run('listAwaitedOriginalPods', () => store.listAwaitedOriginalPods());
  await run('partnerRepliedSince', () => store.partnerRepliedSince(NO_ID, NO_ID, new Date()));
  await run('liveBidSummary', async () => JSON.stringify(await store.liveBidSummary(NO_ID, NO_ID)));
  await run('lastSent', () => store.lastSent(NO_ID, 'LS_N_0103', NO_ID));
  await run('listTransporterBidders', () => store.listTransporterBidders(NO_ID, NO_ID));
  await run('listPartnerBidders', () => store.listPartnerBidders(NO_ID));
  await run('shipper store: findLoadsWithLoadsmartBid', () =>
    memos.findLoadsWithLoadsmartBid({ id: NO_ID, tenantId: NO_ID }),
  );
  await run('shipper store: findLiveLoadsmartBid', () => memos.findLiveLoadsmartBid(NO_ID, NO_ID));
  await run('shipper store: latestAnswer', () => memos.latestAnswer(NO_ID, NO_ID));
  await run('memo store: findUsersByPhone', () => memos.findUsersByPhone(['9000000001']));
  await run('memo store: findLoadsAwaitingMemo', () =>
    memos.findLoadsAwaitingMemo({ id: NO_ID, tenantId: NO_ID }),
  );
  await run('memo store: findLoad', () =>
    memos.findLoad({ id: NO_ID, tenantId: NO_ID }, null, 'LD-NONE'),
  );

  for (const [name, ok, detail] of checks) console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
  await AppDataSource.destroy();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
