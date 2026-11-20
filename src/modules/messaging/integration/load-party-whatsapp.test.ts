import { describe, expect, it } from 'vitest';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadBidEntity } from '../../loads/bids/load-bid.entity';
import { LoadMemoEntity } from '../../loads/memo/load-memo.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { LsPartnerPaymentEntity } from '../../loadsmart-ops/entities/ls-partner-payment.entity';
import { SettingsReader } from '../../settings/settings.types';
import { TemplateSendRequest } from '../outbound/outbound-message.service';
import { TemplateKey } from '../templates/template-registry';
import { AwaitedOriginalPod, LoadNoticeStore, NoticeLoad } from './load-notices.interface';
import { LoadPartyWhatsapp } from './load-party-whatsapp';

const TENANT = 'tenant-1';
const PARTNER = { id: 'partner-1', name: 'Singh Roadways', phone: '9876500001' };
const TRANSPORTER = { id: 'transporter-1', name: 'Own Carriers', phone: '9876500002' };

function loadOf(overrides: Partial<LoadEntity> = {}): LoadEntity {
  return {
    id: 'load-1',
    tenantId: TENANT,
    code: 'LD-1001',
    postingType: 'market_fleet',
    route: 'market',
    awardedParty: 'transporter',
    awardedBidId: 'bid-1',
    transporterId: TRANSPORTER.id,
    vehicleNumber: 'PB10AB1234',
    driverId: null,
    driverName: 'Ramesh',
    driverNumber: '9876500003',
    freightValue: '45000.00',
    shortageOrDamage: 'none',
    deliveredAt: new Date('2026-11-10T06:00:00Z'),
    createdBy: 'user-1',
    settingsVersionId: null,
    ...overrides,
  } as LoadEntity;
}

class FakeStore implements LoadNoticeStore {
  load = loadOf();
  bids: Record<string, Partial<LoadBidEntity>> = {
    'bid-1': { source: 'transporter', rate: '44000.00' },
  };
  partnerRate: string | null = '41000.00';
  sent: {
    loadId: string;
    key: TemplateKey;
    ref: string;
    at: Date;
    variables: Record<string, string>;
  }[] = [];
  replied = false;
  hasApp = false;
  awaited: AwaitedOriginalPod[] = [];
  users: Record<string, { id: string; name: string; phone: string; tenantId: string | null }> = {
    'user-1': { id: 'user-1', name: 'Asha', phone: '9876500004', tenantId: TENANT },
  };
  partnerPayment: Partial<LsPartnerPaymentEntity> | null = {
    paymentType: 'advance',
    netAmount: '30000.00',
    tdsAmount: '300.00',
    utrReference: 'UTR123',
    proofFileKey: 'proofs/advance.pdf',
  };
  loadPayment: Partial<LoadPaymentEntity> | null = {
    transporterId: TRANSPORTER.id,
    amount: '20000.00',
    utrReference: 'UTR9',
    proofFileKey: 'proofs/advance.png',
  };

  async findLoad(): Promise<NoticeLoad | null> {
    return {
      load: this.load,
      origin: 'Gurugram 122001',
      destination: 'Ludhiana',
      destinationQuery: '30.9,75.85',
      reportingAt: new Date('2026-11-15T04:30:00Z'),
      truckLabel: '32 ft',
    };
  }
  async findTransporter() {
    return TRANSPORTER;
  }
  async findLoadPartner() {
    return { contact: PARTNER, partnerRate: this.partnerRate };
  }
  async findUser(userId: string) {
    return this.users[userId] ?? null;
  }
  async shipperName() {
    return 'ABC Steels';
  }
  async findBid(_tenantId: string, bidId: string) {
    return (this.bids[bidId] as LoadBidEntity) ?? null;
  }
  memo = {
    status: 'sent',
    vehicleNumber: 'PB10AB1234',
    driverName: 'Ramesh',
    freightValue: '45000.00',
    expiresAt: new Date('2026-11-14T05:30:00Z'),
  } as LoadMemoEntity;
  async findMemo() {
    return this.memo;
  }
  async findPartnerPayment() {
    return this.partnerPayment as LsPartnerPaymentEntity | null;
  }
  async findLoadPayment() {
    return this.loadPayment as LoadPaymentEntity | null;
  }
  async driverHasApp() {
    return this.hasApp;
  }
  async hasSent(loadId: string, key: TemplateKey, ref: string, since?: Date) {
    return this.sent.some(
      (row) =>
        row.loadId === loadId && row.key === key && row.ref === ref && (!since || row.at >= since),
    );
  }
  async listAwaitedOriginalPods() {
    return this.awaited;
  }
  async partnerRepliedSince() {
    return this.replied;
  }
  liveBids = { count: 1, bestRate: '42000' as string | null };
  transporterBidders = [TRANSPORTER, { id: 'transporter-2', name: 'Other', phone: '9876500005' }];
  partnerBidders = [PARTNER, { id: 'partner-2', name: 'Kaur Logistics', phone: '9876500006' }];
  async liveBidSummary() {
    return this.liveBids;
  }
  async sentVariables(loadId: string, key: TemplateKey, ref: string) {
    return this.sent
      .filter((row) => row.loadId === loadId && row.key === key && row.ref === ref)
      .map((row) => row.variables);
  }
  async lastSent(loadId: string, key: TemplateKey, ref: string) {
    const rows = this.sent.filter(
      (row) => row.loadId === loadId && row.key === key && row.ref === ref,
    );
    const last = rows[rows.length - 1];
    return last ? { createdAt: last.at, variables: last.variables } : null;
  }
  async listTransporterBidders() {
    return this.transporterBidders;
  }
  async listPartnerBidders() {
    return this.partnerBidders;
  }
}

const settings: SettingsReader = {
  current: async () =>
    ({ values: { originalPodDueDays: 20, originalPodPenaltyPerDay: 100 } }) as never,
  forLoad: async () =>
    ({ values: { originalPodDueDays: 20, originalPodPenaltyPerDay: 100 } }) as never,
};

function setup(start = new Date('2026-11-18T05:00:00Z')) {
  const clock = { now: start };
  const store = new FakeStore();
  const requests: TemplateSendRequest[] = [];
  const rollups: { job: { tenantId: string; loadId: string }; delayMs: number }[] = [];
  const reminders: {
    job: { tenantId: string; loadId: string; memoId: string };
    delayMs: number;
  }[] = [];
  const outbound = {
    sendTemplate: async (request: TemplateSendRequest) => {
      requests.push(request);
      store.sent.push({
        loadId: request.loadId!,
        key: request.templateKey,
        ref: request.recipient.refId!,
        at: clock.now,
        variables: request.variables,
      });
      return { messageLogId: `log-${requests.length}`, status: 'queued' as const };
    },
  };
  const notices = new LoadPartyWhatsapp(
    store,
    outbound,
    settings,
    async (key) => `https://files.example/${key}?signed`,
    async (job, delayMs) => {
      rollups.push({ job, delayMs });
    },
    { error: () => undefined, warn: () => undefined },
    () => clock.now,
    async (job, delayMs) => {
      reminders.push({ job, delayMs });
    },
  );
  return { store, requests, notices, rollups, reminders, clock };
}

const at = new Date('2026-11-18T05:00:00Z');

describe('LoadPartyWhatsapp — bids and the memo', () => {
  it("LS_N_0107: the shipper accepted Loadsmart's bid → the partner behind it, once", async () => {
    const { store, requests, notices } = setup();
    store.load = loadOf({ route: null, awardedParty: 'loadsmart' });
    store.bids['bid-1'] = { source: 'loadsmart', rate: '47000.00' };
    await notices.onLoadEvent({
      kind: 'assigned',
      tenantId: TENANT,
      loadId: 'load-1',
      at,
      vehicleChecked: false,
      driverChecked: false,
    });
    await notices.onLoadEvent({
      kind: 'assigned',
      tenantId: TENANT,
      loadId: 'load-1',
      at,
      vehicleChecked: false,
      driverChecked: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0107',
      recipient: { kind: 'partner', refId: PARTNER.id, phone: PARTNER.phone },
      variables: { rate: '41,000', from_area: 'Gurugram 122001', to_area: 'Ludhiana' },
      loadRef: 'LD-1001',
    });
  });

  it("LS_N_0121: a transporter's bid accepted, and an indent accepted at the contract rate", async () => {
    const { store, requests, notices } = setup();
    await notices.onLoadEvent({
      kind: 'assigned',
      tenantId: TENANT,
      loadId: 'load-1',
      at,
      vehicleChecked: false,
      driverChecked: false,
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0121',
      recipient: { kind: 'transporter', refId: TRANSPORTER.id },
      variables: { rate: '44,000', shipper_name: 'ABC Steels', origin: 'Gurugram 122001' },
    });

    store.load = loadOf({ id: 'load-2', postingType: 'indent', route: 'indent' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-2',
      to: 'bids_received',
      at,
    });
    expect(requests[1]).toMatchObject({ templateKey: 'LS_N_0121', variables: { rate: '45,000' } });

    // A market load reaching Bids received (its first bid) is not an acceptance.
    store.load = loadOf({ id: 'load-3' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-3',
      to: 'bids_received',
      at,
    });
    expect(requests).toHaveLength(2);
  });

  it('LS_N_0069: the memo to the shipper user who posted the load, with the View memo link', async () => {
    const { store, requests, notices } = setup();
    await notices.notify({
      kind: 'memo_sent',
      tenantId: TENANT,
      loadId: 'load-1',
      memoId: 'memo-1',
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0069',
      recipient: { kind: 'shipper_user', refId: 'user-1', phone: '9876500004' },
      variables: {
        vehicle_no: 'PB10AB1234',
        driver_name: 'Ramesh',
        price: '45,000',
        expiry_time: '14 Nov, 11:00 am',
        load_uuid: 'load-1',
      },
    });
    // Not to a user of another tenant.
    store.users['user-1'].tenantId = 'other';
    await notices.notify({
      kind: 'memo_sent',
      tenantId: TENANT,
      loadId: 'load-1',
      memoId: 'memo-2',
    });
    expect(requests).toHaveLength(1);
  });

  it('LS_N_0110 (partner, Loadsmart load) and LS_N_0123 (own transporter) once the memo is accepted', async () => {
    const { store, requests, notices } = setup();
    // Only the chosen bidders here (the "not chosen" messages have their own test).
    store.partnerBidders = [PARTNER];
    store.transporterBidders = [TRANSPORTER];
    store.load = loadOf({ route: 'loadsmart', awardedParty: 'loadsmart' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-1',
      to: 'truck_assigned',
      at,
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0110',
      recipient: { kind: 'partner' },
      variables: {
        load_id: 'LD-1001',
        vehicle_no: 'PB10AB1234',
        driver_name: 'Ramesh',
        reporting_time: '15 Nov, 10:00 am',
        load_uuid: 'load-1',
      },
    });

    store.load = loadOf({ id: 'load-2' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-2',
      to: 'truck_assigned',
      at,
    });
    expect(requests[1]).toMatchObject({
      templateKey: 'LS_N_0123',
      recipient: { kind: 'transporter' },
      variables: { shipper_name: 'ABC Steels', vehicle_no: 'PB10AB1234', load_uuid: 'load-2' },
    });

    store.load = loadOf({ id: 'load-3', postingType: 'own_fleet', route: 'own_fleet' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-3',
      to: 'truck_assigned',
      at,
    });
    expect(requests).toHaveLength(2);
  });
});

describe('LoadPartyWhatsapp — papers, POD and payments', () => {
  it('LS_N_0130: papers approved on a Loadsmart load → the driver, held when on the app', async () => {
    const { store, requests, notices } = setup();
    store.load = loadOf({ route: 'loadsmart' });
    store.hasApp = true;
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-1',
      to: 'loaded',
      at,
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0130',
      recipient: { kind: 'driver', phone: '9876500003' },
      variables: {
        vehicle_no: 'PB10AB1234',
        destination: 'Ludhiana',
        destination_query: '30.9,75.85',
      },
      driverHasApp: true,
    });
  });

  it('LS_N_0124: POD uploaded on an own-transporter load; never on a Loadsmart load', async () => {
    const { store, requests, notices } = setup();
    await notices.onLoadEvent({ kind: 'pod_uploaded', tenantId: TENANT, loadId: 'load-1', at });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0124',
      recipient: { kind: 'transporter' },
    });
    store.load = loadOf({ id: 'load-2', route: 'loadsmart' });
    await notices.onLoadEvent({ kind: 'pod_uploaded', tenantId: TENANT, loadId: 'load-2', at });
    expect(requests).toHaveLength(1);
  });

  it('POD approved with damage on a Loadsmart load: LS_N_0114 then LS_N_0115 with the due date', async () => {
    const { store, requests, notices } = setup();
    store.load = loadOf({ route: 'loadsmart', shortageOrDamage: 'damage' });
    await notices.onLoadEvent({
      kind: 'pod_reviewed',
      tenantId: TENANT,
      loadId: 'load-1',
      decision: 'accepted',
      at,
    });
    expect(requests.map((request) => request.templateKey)).toEqual(['LS_N_0114', 'LS_N_0115']);
    expect(requests[0].variables).toEqual({ load_id: 'LD-1001', issue_type: 'damage' });
    // Delivered 10 Nov (IST) + 20 days.
    expect(requests[1].variables).toEqual({ load_id: 'LD-1001', pod_due_date: '30 Nov' });
  });

  it('LS_N_0112: a partner payment with its proof as the document header; none without a proof', async () => {
    const { store, requests, notices } = setup();
    store.load = loadOf({ route: 'loadsmart' });
    await notices.notify({
      kind: 'partner_paid',
      tenantId: TENANT,
      loadId: 'load-1',
      partnerPaymentId: 'pay-1',
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0112',
      variables: {
        payment_head: 'Advance',
        net_amount: '30,000',
        tds_amount: '300',
        utr: 'UTR123',
      },
      headerDocument: {
        link: 'https://files.example/proofs/advance.pdf?signed',
        filename: 'LD-1001 Advance payment proof.pdf',
      },
    });
    store.partnerPayment = { ...store.partnerPayment, proofFileKey: null };
    await notices.notify({
      kind: 'partner_paid',
      tenantId: TENANT,
      loadId: 'load-1',
      partnerPaymentId: 'pay-2',
    });
    expect(requests).toHaveLength(1);
  });

  it('LS_N_0126 to the own transporter; LS_N_0117 when the original POD is received', async () => {
    const { requests, notices } = setup();
    await notices.notify({
      kind: 'transporter_payment_recorded',
      tenantId: TENANT,
      loadId: 'load-1',
      paymentId: 'p-1',
    });
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0126',
      variables: { shipper_name: 'ABC Steels', amount: '20,000', utr: 'UTR9' },
      headerDocument: { filename: 'LD-1001 payment proof.png' },
    });
    await notices.notify({ kind: 'original_pod_received', tenantId: TENANT, loadId: 'load-1' });
    expect(requests[1]).toMatchObject({
      templateKey: 'LS_N_0117',
      variables: { load_id: 'LD-1001' },
    });
  });

  it('never throws when a lookup fails', async () => {
    const { store, notices } = setup();
    store.findLoad = async () => {
      throw new Error('db down');
    };
    await expect(
      notices.notify({ kind: 'original_pod_received', tenantId: TENANT, loadId: 'load-1' }),
    ).resolves.toBeUndefined();
    await expect(
      notices.onLoadEvent({ kind: 'pod_uploaded', tenantId: TENANT, loadId: 'load-1', at }),
    ).resolves.toBeUndefined();
  });
});

describe('LoadPartyWhatsapp — daily original POD follow-up (due in 20 days)', () => {
  const runOn = async (isoDay: string, prepare?: (store: FakeStore) => void) => {
    const context = setup(new Date(`${isoDay}T04:30:00Z`));
    context.store.load = loadOf({ route: 'loadsmart' });
    context.store.awaited = [{ tenantId: TENANT, loadId: 'load-1', deliveredOn: '2026-11-01' }];
    prepare?.(context.store);
    const count = await context.notices.runOriginalPodFollowUps();
    return { ...context, count };
  };

  it('LS_N_0115 on days 10, 18 and 20; nothing in between', async () => {
    expect((await runOn('2026-11-11')).requests[0]).toMatchObject({
      templateKey: 'LS_N_0115',
      variables: { pod_due_date: '21 Nov' },
    });
    expect((await runOn('2026-11-19')).count).toBe(1);
    expect((await runOn('2026-11-21')).count).toBe(1);
    expect((await runOn('2026-11-15')).count).toBe(0);
  });

  it('no reminder once the partner has replied, nor twice the same day', async () => {
    expect((await runOn('2026-11-11', (store) => (store.replied = true))).count).toBe(0);
    const { notices, requests } = await runOn('2026-11-11');
    await notices.runOriginalPodFollowUps();
    expect(requests).toHaveLength(1);
  });

  it('LS_N_0116 on day 21 and every 7 days after, with the penalty so far', async () => {
    const day21 = await runOn('2026-11-22');
    expect(day21.requests[0]).toMatchObject({
      templateKey: 'LS_N_0116',
      variables: { load_id: 'LD-1001', penalty_amount: '100' },
    });
    expect((await runOn('2026-11-29')).requests[0].variables.penalty_amount).toBe('800');
    expect((await runOn('2026-11-25')).count).toBe(0);
  });
});

describe('LoadPartyWhatsapp — bids to the shipper and "not chosen"', () => {
  it("LS_N_0067: Loadsmart's bid to the shipper user who posted the load, every time it is sent", async () => {
    const { store, requests, notices } = setup();
    store.bids['bid-ls'] = { source: 'loadsmart', rate: '47500.00' };
    await notices.notify({
      kind: 'loadsmart_bid_sent',
      tenantId: TENANT,
      loadId: 'load-1',
      bidId: 'bid-ls',
    });
    await notices.notify({
      kind: 'loadsmart_bid_sent',
      tenantId: TENANT,
      loadId: 'load-1',
      bidId: 'bid-ls',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0067',
      recipient: { kind: 'shipper_user', refId: 'user-1' },
      variables: {
        origin: 'Gurugram 122001',
        destination: 'Ludhiana',
        truck_type: '32 ft',
        reporting_time: '15 Nov, 10:00 am',
        price: '47,500',
      },
    });
  });

  it('LS_N_0103: the first bid at once, then one roll-up per 30 minutes, only when the count changed', async () => {
    const { store, requests, notices, rollups, clock } = setup();
    store.load = loadOf({ status: 'bids_received', awardedBidId: null });
    const bid = {
      kind: 'bid_received' as const,
      tenantId: TENANT,
      loadId: 'load-1',
      bidId: 'bid-1',
    };
    await notices.notify(bid);
    expect(requests[0]).toMatchObject({
      templateKey: 'LS_N_0103',
      variables: { bid_count: '1', best_rate: '42,000', load_uuid: 'load-1' },
    });

    // 10 minutes later a second bid: queued for the end of the 30 minutes, not sent now.
    clock.now = new Date(clock.now.getTime() + 10 * 60_000);
    store.liveBids = { count: 2, bestRate: '41000' };
    await notices.notify(bid);
    expect(requests).toHaveLength(1);
    expect(rollups[0]).toEqual({
      job: { tenantId: TENANT, loadId: 'load-1' },
      delayMs: 20 * 60_000,
    });

    // The roll-up runs: 2 bids now.
    clock.now = new Date(clock.now.getTime() + 20 * 60_000);
    await notices.runBidsRollup({ tenantId: TENANT, loadId: 'load-1' });
    expect(requests[1]).toMatchObject({ variables: { bid_count: '2', best_rate: '41,000' } });

    // Nothing new → no message.
    clock.now = new Date(clock.now.getTime() + 31 * 60_000);
    await notices.runBidsRollup({ tenantId: TENANT, loadId: 'load-1' });
    expect(requests).toHaveLength(2);

    // Not once the load is awarded.
    store.load = loadOf({ status: 'bids_received', awardedBidId: 'bid-1' });
    store.liveBids = { count: 3, bestRate: '40000' };
    await notices.runBidsRollup({ tenantId: TENANT, loadId: 'load-1' });
    expect(requests).toHaveLength(2);
  });

  it('memo accepted: LS_N_0122 to the other transporters who bid, LS_N_0109 to the other brokers', async () => {
    const { store, requests, notices } = setup();
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-1',
      to: 'truck_assigned',
      at,
    });
    expect(requests.map((request) => [request.templateKey, request.recipient.refId])).toEqual([
      ['LS_N_0122', 'transporter-2'],
      ['LS_N_0123', TRANSPORTER.id],
    ]);
    expect(requests[0].variables).toEqual({
      shipper_name: 'ABC Steels',
      origin: 'Gurugram 122001',
      destination: 'Ludhiana',
    });

    store.load = loadOf({ id: 'load-2', route: 'loadsmart' });
    await notices.onLoadEvent({
      kind: 'stage_changed',
      tenantId: TENANT,
      loadId: 'load-2',
      to: 'truck_assigned',
      at,
    });
    expect(
      requests.slice(2).map((request) => [request.templateKey, request.recipient.refId]),
    ).toEqual([
      ['LS_N_0110', PARTNER.id],
      ['LS_N_0109', 'partner-2'],
    ]);
    expect(requests[3].variables).toEqual({ from_area: 'Gurugram 122001', to_area: 'Ludhiana' });
  });
});
