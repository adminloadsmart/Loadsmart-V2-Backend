/**
 * Local check of messaging Part 5 lookups on real Postgres (read-only, nothing is sent):
 * the transporter offer query for a phone, one offer by recipient + load, the stage memory query.
 * Run: npx ts-node --transpile-only -r reflect-metadata scripts/messaging-part5-db-check.ts
 */
import { AppDataSource } from '../src/db/data-source';
import { LoadRecipientEntity } from '../src/modules/loads/load-posting/entities/load-recipient.entity';
import { LoadEntity } from '../src/modules/loads/entities/load.entity';
import { WhatsappInboundRepository } from '../src/modules/messaging/repositories/whatsapp-inbound.repository';
import {
  TypeormTransporterOfferStore,
  phoneVariantsOf,
} from '../src/modules/messaging/integration/transporter-load-store';
import { LoadsmartRepository } from '../src/modules/loadsmart-ops/loadsmart.repository';
import { LsSourcingService } from '../src/modules/loadsmart-ops/ls-sourcing.service';

async function main() {
  await AppDataSource.initialize();
  const store = new TypeormTransporterOfferStore(
    AppDataSource,
    new WhatsappInboundRepository(AppDataSource),
  );
  const checks: [string, boolean, string][] = [];

  // Latest transporter recipient with a load — used as a far-past "now" so its posting is in the window.
  // Prefer a recipient whose load is still open, so the positive path is checked.
  const recipients = await AppDataSource.getRepository(LoadRecipientEntity).find({
    where: { recipientType: 'transporter' },
    relations: { posting: true, transporter: true },
    order: { createdAt: 'DESC' },
    take: 200,
  });
  let recipient: LoadRecipientEntity | null = null;
  let load: LoadEntity | null = null;
  for (const candidate of recipients) {
    const candidateLoad = await AppDataSource.getRepository(LoadEntity).findOneBy({
      postingId: candidate.postingId,
    });
    if (!candidateLoad || !candidate.transporter) continue;
    if (!recipient) [recipient, load] = [candidate, candidateLoad];
    if (
      ['created', 'bids_received'].includes(candidateLoad.status) &&
      ['market', 'indent'].includes(candidateLoad.sourceType)
    ) {
      [recipient, load] = [candidate, candidateLoad];
      break;
    }
  }
  if (!recipient || !load || !recipient.transporter) {
    console.log(
      '⚠️ no transporter recipient with a load in the local DB — only query compilation is checked',
    );
    const none = await store.findOpenOffersForPhone('919999999990', new Date());
    checks.push(['open-offers query runs', Array.isArray(none), `${none.length} rows`]);
  } else {
    const justAfterPosting = new Date(recipient.posting.createdAt.getTime() + 60 * 1000);
    const open = await store.findOpenOffersForPhone(
      `91${recipient.transporter.phone.slice(-10)}`,
      justAfterPosting,
    );
    const expectOpen =
      ['created', 'bids_received'].includes(load.status) &&
      ['market', 'indent'].includes(load.sourceType);
    checks.push([
      `open offers for ${recipient.transporter.phone.slice(-4)} (load ${load.code} ${load.sourceType}/${load.status})`,
      expectOpen
        ? open.some((offer) => offer.loadId === load.id)
        : !open.some((offer) => offer.loadId === load.id),
      open.map((offer) => `${offer.loadCode} ${offer.laneLabel}`).join(' | ') || 'none',
    ]);
    const byRef = await store.findOffer(recipient.id, null, load.code);
    const byId = await store.findOffer(recipient.id, load.id, 'ignored');
    checks.push([
      'findOffer by code and by id agree',
      byRef?.loadId === load.id && byId?.loadId === load.id,
      `${byRef?.loadCode}`,
    ]);
    const answer = await store.latestOfferAnswer(load.id, recipient.id);
    checks.push([
      'stage-memory query runs',
      answer === null || typeof answer === 'string',
      String(answer),
    ]);
  }
  // Partner side (5b): only the repository is needed for these reads.
  const sourcingService = new LsSourcingService(
    new LoadsmartRepository(AppDataSource),
    ...([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ] as unknown as [never, never, never, never, never, never, never]),
  );
  const partners = await sourcingService.listActivePartners();
  const boardLoads = await sourcingService.openBoardLoads();
  checks.push([
    'active partners + open board loads query',
    Array.isArray(partners) && Array.isArray(boardLoads),
    `${partners.length} partners, ${boardLoads.length} board loads${boardLoads[0] ? ` (e.g. ${boardLoads[0].loadCode} ${boardLoads[0].pickupLabel} → ${boardLoads[0].dropLabel})` : ''}`,
  ]);
  if (partners[0]) {
    const byPhone = await sourcingService.findActivePartnersByPhones(
      phoneVariantsOf(`91${partners[0].phone.slice(-10)}`),
    );
    checks.push([
      'partner found by its WhatsApp number',
      byPhone.some((partner) => partner.id === partners[0].id),
      partners[0].phone.slice(-4),
    ]);
  }
  for (const [name, passed, detail] of checks)
    console.log(`${passed ? '✅' : '❌'} ${name} — ${detail}`);
  await AppDataSource.destroy();
  process.exit(checks.every(([, passed]) => passed) ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
