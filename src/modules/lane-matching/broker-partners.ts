import { EntityManager, In, IsNull } from 'typeorm';
import { BrokerEntity } from '../loads/brokers/broker.entity';
import { LsPartnerEntity } from '../loadsmart-ops/entities/ls-partner.entity';
import { phoneKey } from './lane-match-rules';

/** The ls_partners row each broker's bids are kept on: linked by broker_id, else the partner
 *  with the same phone (linked now), else a new broker partner. Shared by lane matching and the
 *  broker page (which keeps "Added by Loadsmart" on the partner row). */
export async function partnersForBrokers(
  manager: Pick<EntityManager, 'getRepository'>,
  brokers: readonly BrokerEntity[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!brokers.length) return ids;
  const repo = manager.getRepository(LsPartnerEntity);
  const linked = await repo.find({ where: { brokerId: In(brokers.map((b) => b.id)) } });
  for (const partner of linked) ids.set(partner.brokerId!, partner.id);
  const unlinked = brokers.filter((broker) => !ids.has(broker.id));
  if (!unlinked.length) return ids;
  // Phones are stored in several forms ("98290 73162", "+919829073162"): compare the last 10
  // digits, over the partners no broker has claimed yet.
  const samePhone = await repo.find({ where: { brokerId: IsNull() } });
  for (const broker of unlinked) {
    const existing = samePhone.find(
      (partner) => phoneKey(partner.phone) === phoneKey(broker.phone),
    );
    if (existing) {
      await repo.update(existing.id, { brokerId: broker.id });
      ids.set(broker.id, existing.id);
      continue;
    }
    const created = await repo.save(
      repo.create({
        name: broker.truckerCompany,
        phone: broker.phone,
        partnerType: 'broker',
        status: 'active',
        tdsPercent: broker.tdsPercent,
        brokerId: broker.id,
      }),
    );
    ids.set(broker.id, created.id);
  }
  return ids;
}
