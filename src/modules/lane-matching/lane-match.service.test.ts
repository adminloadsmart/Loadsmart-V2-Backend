import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { BrokerEntity } from '../loads/brokers/broker.entity';
import { LsPartnerEntity } from '../loadsmart-ops/entities/ls-partner.entity';
import { TransporterEntity } from '../masters/transporter/entities/transporter.entity';
import { cityKey } from './geo-place-resolver';
import { LaneMatchService } from './lane-match.service';
import { routeOf } from './lane-match-rules';

const broker = (overrides: Partial<BrokerEntity>): BrokerEntity =>
  ({
    id: 'broker-1',
    truckerCompany: 'Shyam Kripa Roadlines',
    truckerName: 'Manoj',
    phone: '9829073162',
    isOnWhatsapp: true,
    laneOrigin: 'Rajasthan',
    laneDestinations: ['Punjab', 'NCR'],
    status: 'approved',
    tdsPercent: '1',
    loadsLast30Days: 0,
    rating: null,
    ...overrides,
  }) as BrokerEntity;

/** A DataSource over in-memory rows: brokers, partners and transporters. */
function fakeDataSource(rows: {
  brokers?: BrokerEntity[];
  partners?: LsPartnerEntity[];
  transporters?: TransporterEntity[];
}) {
  const partners = rows.partners ?? [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '_type' in value) {
        const operator = value as { _type: string; _value: unknown };
        if (operator._type === 'in') return (operator._value as unknown[]).includes(row[key]);
        if (operator._type === 'isNull') return row[key] === null || row[key] === undefined;
      }
      return row[key] === value;
    });
  const repos = new Map<unknown, unknown>([
    [
      BrokerEntity,
      {
        find: async ({ where }: { where: Record<string, unknown> }) =>
          (rows.brokers ?? []).filter((row) => matches(row as never, where)),
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
          (rows.brokers ?? []).find((row) => matches(row as never, where)) ?? null,
      },
    ],
    [
      LsPartnerEntity,
      {
        find: async ({ where }: { where: Record<string, unknown> }) =>
          partners.filter((row) => matches(row as never, where)),
        update: async (id: string, data: Partial<LsPartnerEntity>) => {
          Object.assign(
            partners.find((row) => row.id === id)!,
            data,
          );
        },
        create: (data: Partial<LsPartnerEntity>) => ({ ...data }),
        save: async (data: LsPartnerEntity) => {
          const saved = { ...data, id: `partner-${partners.length + 1}` };
          partners.push(saved);
          return saved;
        },
      },
    ],
    [
      TransporterEntity,
      {
        find: async ({ where }: { where: Record<string, unknown> }) =>
          (rows.transporters ?? []).filter((row) =>
            matches(row as never, { tenantId: where.tenantId, status: where.status }),
          ),
      },
    ],
  ]);
  return {
    dataSource: { getRepository: (entity: unknown) => repos.get(entity) } as unknown as DataSource,
    partners,
  };
}

const noPoints = { pointsOf: async () => new Map() };
const jaipurToLudhiana = routeOf(
  { city: 'Jaipur', state: 'Rajasthan', latitude: 26.91, longitude: 75.79 },
  { city: 'Ludhiana', state: 'Punjab', latitude: 30.9, longitude: 75.85 },
);

describe('LaneMatchService.matchBrokers', () => {
  it('finds approved brokers on the lane and gives each a partner row for its bids', async () => {
    const { dataSource, partners } = fakeDataSource({
      brokers: [
        broker({ id: 'b-raj', phone: '9829073162' }),
        broker({
          id: 'b-guj',
          phone: '9725060555',
          laneOrigin: 'Gujarat',
          laneDestinations: ['Maharashtra'],
        }),
        broker({ id: 'b-held', phone: '9000000001', status: 'on_hold' }),
      ],
      partners: [
        { id: 'p-old', phone: '+91 98290 73162', brokerId: null, name: 'Old' } as LsPartnerEntity,
      ],
    });
    const matches = await new LaneMatchService(dataSource, noPoints).matchBrokers(jaipurToLudhiana);
    expect(matches.map((m) => [m.brokerId, m.partnerId, m.match.kind])).toEqual([
      ['b-raj', 'p-old', 'lane'],
    ]);
    // The partner with the same phone is linked, not duplicated.
    expect(partners).toHaveLength(1);
    expect(partners[0].brokerId).toBe('b-raj');
  });

  it('creates a partner for a broker seen for the first time', async () => {
    const { dataSource, partners } = fakeDataSource({ brokers: [broker({ id: 'b-new' })] });
    const [match] = await new LaneMatchService(dataSource, noPoints).matchBrokers(jaipurToLudhiana);
    expect(match.partnerId).toBe('partner-1');
    expect(partners[0]).toMatchObject({
      brokerId: 'b-new',
      partnerType: 'broker',
      status: 'active',
    });
  });

  it('sends nothing to a load no broker runs', async () => {
    const { dataSource } = fakeDataSource({
      brokers: [broker({ laneOrigin: 'Kerala', laneDestinations: ['Karnataka'] })],
    });
    expect(await new LaneMatchService(dataSource, noPoints).matchBrokers(jaipurToLudhiana)).toEqual(
      [],
    );
  });
});

describe('LaneMatchService.matchTransporters', () => {
  const lane = (from: string, to: string, deletedAt: Date | null = null) => ({
    originCity: from,
    originState: null,
    destinationCity: to,
    destinationState: null,
    deletedAt,
  });
  const transporter = (id: string, phone: string, lanes: ReturnType<typeof lane>[]) =>
    ({
      id,
      tenantId: 't-1',
      name: id,
      phone,
      status: 'active',
      deletedAt: null,
      lanes,
    }) as unknown as TransporterEntity;

  it('takes the transporters whose lane the load runs or lies on, one per phone', async () => {
    const points = new Map([
      [cityKey({ city: 'Delhi' }), { lat: 28.61, lng: 77.21 }],
      [cityKey({ city: 'Mumbai' }), { lat: 19.08, lng: 72.88 }],
    ]);
    const { dataSource } = fakeDataSource({
      transporters: [
        transporter('exact', '9000000001', [lane('Jaipur', 'Surat')]),
        transporter('on-the-way', '9000000002', [lane('Delhi', 'Mumbai')]),
        transporter('same-phone', '9000000001', [lane('Jaipur', 'Surat')]),
        transporter('removed-lane', '9000000003', [lane('Jaipur', 'Surat', new Date())]),
        transporter('elsewhere', '9000000004', [lane('Chennai', 'Kochi')]),
      ],
    });
    const service = new LaneMatchService(dataSource, { pointsOf: async () => points });
    const matches = await service.matchTransporters(
      't-1',
      routeOf(
        { city: 'Jaipur', state: 'Rajasthan', latitude: 26.91, longitude: 75.79 },
        { city: 'Surat', state: 'Gujarat', latitude: 21.17, longitude: 72.83 },
      ),
    );
    expect(matches.map((m) => [m.transporterId, m.match.kind])).toEqual([
      ['exact', 'lane'],
      ['on-the-way', 'en_route'],
    ]);
  });
});
