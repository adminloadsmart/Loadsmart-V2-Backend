import { DataSource, In, MoreThanOrEqual } from 'typeorm';
import { NotFoundError } from '../../shared/errors';
import { PermissionHolder } from '../../shared/middleware/require-permission.middleware';
import { TrackingClient } from '../../adapters/tracking.client';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadStageHistoryEntity } from '../loads/entities/load-stage-history.entity';
import type { LoadCancelService } from '../loads/sourcing/load-cancel.service';
import { LoadPaymentRepository } from '../loads/payments/load-payment.repository';
import { LoadStatus } from '../loads/utils/loads.types';
import { istDateOf } from '../loads/verification/verification-rules';
import { SettingsReader } from '../settings/settings.types';
import { AllLoadsFilter, AllLoadsRow, ConsoleRepository } from './console.repository';
import {
  ConsoleTeam,
  LiveStatus,
  changePercent,
  liveStatus,
  moneyVisibility,
  previousPeriod,
  teamHolding,
} from './console-rules';
import { AGEING_BUCKETS, AgeingBucket, ageingBucket } from './billing-rules';
import { tripAmount } from './loadsmart-rules';
import { LoadsmartRepository } from './loadsmart.repository';

const round2 = (value: number) => Math.round(value * 100) / 100;
const marginPercent = (shipper: number, carrier: number) =>
  shipper ? Math.round(((shipper - carrier) / shipper) * 1000) / 10 : null;

const LIVE_STAGES: LoadStatus[] = [
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
];
/** How many trips the live map asks tracking about at once. */
const TRACKING_CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AllLoadsQuery extends AllLoadsFilter {
  team?: ConsoleTeam;
  page?: number;
  limit?: number;
}

/**
 * The console's cross-team read views:
 * - All loads (L01): every Loadsmart load, whichever team holds it, and one load's panel;
 * - Super Admin approvals (S01): carrier advances and balances waiting for a decision, worked out
 *   line by line, with the charges Tracking raised lately;
 * - Analytics (S02): a period against the previous one;
 * - Live map (T07): every live load with its last position from the tracking service.
 * Money is shown as each team may see it (console-rules.ts moneyVisibility).
 */
export class LsConsoleService {
  private readonly history;

  constructor(
    dataSource: DataSource,
    private readonly repository: LoadsmartRepository,
    private readonly consoleRepository: ConsoleRepository,
    private readonly loadActivityService: LoadActivityService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly trackingClient: TrackingClient,
    private readonly settings: SettingsReader,
    private readonly loadCancel: Pick<LoadCancelService, 'listPending' | 'decide'>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.history = dataSource.getRepository(LoadStageHistoryEntity);
  }

  // --- All loads (L01) -----------------------------------------------------------------------

  async allLoads(actor: PermissionHolder, query: AllLoadsQuery) {
    const rows = await this.consoleRepository.allLoads(query);
    const see = moneyVisibility(actor);
    const withTeam = rows
      .map((row) => ({ row, team: this.teamOf(row) }))
      .filter((item) => !query.team || item.team === query.team);
    const counts: Partial<Record<ConsoleTeam, number>> = {};
    for (const item of withTeam) counts[item.team] = (counts[item.team] ?? 0) + 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const page = Math.max(query.page ?? 1, 1);
    return {
      total: withTeam.length,
      counts,
      page,
      limit,
      items: withTeam.slice((page - 1) * limit, page * limit).map(({ row, team }) => ({
        loadId: row.loadId,
        code: row.code,
        shipper: { tenantId: row.tenantId, name: row.shipperName },
        route: { fromCity: row.fromCity, toCity: row.toCity },
        loadingAt: row.pickupAt,
        truck: {
          vehicleNumber: row.vehicleNumber,
          driverName: row.driverName,
          carrier: row.partnerName,
        },
        movement: { status: row.status, since: row.lastStageAt },
        money: this.money(see, row.shipperTrip, row.carrierTrip),
        carrierAdvance: see.carrier ? (row.advanceStatus ?? 'not_raised') : undefined,
        invoice: see.shipper ? (row.invoiceStatus ?? 'not_issued') : undefined,
        team,
      })),
    };
  }

  /** One load's panel: milestones, money on both sides, goods and e-way bill, people, latest
   *  events, and the team holding it. */
  async loadPanel(actor: PermissionHolder, loadId: string) {
    const sourcing = await this.repository.sourcings.findOne({
      where: { loadId },
      relations: { load: { posting: true }, partner: true },
    });
    if (!sourcing) throw new NotFoundError(`Loadsmart load ${loadId} not found`);
    const load = sourcing.load;
    const see = moneyVisibility(actor);
    const [milestones, events, shipperPayments, partnerPayments, claim, invoice, originalPod] =
      await Promise.all([
        this.history.find({ where: { loadId }, order: { enteredAt: 'ASC' } }),
        this.loadActivityService.listByLoad(sourcing.tenantId, loadId),
        this.loadPaymentRepository.listByLoad(sourcing.tenantId, loadId),
        this.repository.partnerPayments.findBy({ sourcingId: sourcing.id }),
        this.repository.findClaim(loadId),
        this.repository.findInvoice(sourcing.tenantId, loadId),
        this.repository.originalPods.findOneBy({ loadId }),
      ]);
    const tonnes = Number(load.plannedCapacityTonnes);
    const shipperTrip = load.freightValue
      ? tripAmount(Number(load.freightValue), load.freightType, tonnes)
      : null;
    const carrierTrip = sourcing.partnerRate
      ? tripAmount(Number(sourcing.partnerRate), load.freightType, tonnes)
      : null;
    const advance = partnerPayments.find((payment) => payment.paymentType === 'advance');
    const balance = partnerPayments.find((payment) => payment.paymentType === 'balance');
    const posting = load.posting;
    const shipperName = await this.consoleRepository.shipperName(sourcing.tenantId);
    return {
      load: { id: load.id, code: load.code, status: load.status, route: load.route },
      team: teamHolding({
        sourcingStatus: sourcing.status,
        loadStatus: load.status,
        claimOpen: claim?.status === 'open',
        invoiceStatus: invoice?.status ?? null,
        carrierBalancePaid: balance?.status === 'paid',
      }),
      milestones: milestones.map((row) => ({
        stage: row.stage,
        enteredAt: row.enteredAt,
        exitedAt: row.exitedAt,
        by: row.actorType,
        channel: row.channel,
      })),
      money: {
        ...this.money(see, shipperTrip, carrierTrip),
        shipperAdvance: see.shipper
          ? shipperPayments.some((payment) => payment.paymentType === 'advance')
            ? 'paid'
            : load.advancePercentage
              ? 'due'
              : 'none'
          : undefined,
        carrierAdvance: see.carrier ? (advance?.status ?? 'not_raised') : undefined,
        carrierBalance: see.carrier ? (balance?.status ?? 'not_raised') : undefined,
        invoice:
          see.shipper && invoice
            ? { number: invoice.invoiceNumber, status: invoice.status, open: invoice.openAmount }
            : undefined,
      },
      goods: {
        commodity: posting?.commodityName ?? null,
        packaging: posting?.packaging ?? null,
        weightTonnes: posting?.weightTonnes ?? load.plannedCapacityTonnes,
        invoiceNumber: load.invoiceNumber,
        invoiceValue: see.shipper ? load.invoiceValue : undefined,
        ewayBillNumber: load.ewayBillNumber,
        ewayBillGeneratedAt: load.ewayBillGeneratedAt,
        elrNumber: load.elrNumber,
      },
      // "Contact details are never masked in the console."
      people: {
        driver: { name: load.driverName, phone: load.driverNumber },
        carrier: sourcing.partner
          ? { name: sourcing.partner.name, phone: sourcing.partner.phone }
          : null,
        truckerSales: sourcing.partner?.truckerSalesName
          ? { name: sourcing.partner.truckerSalesName, phone: sourcing.partner.truckerSalesPhone }
          : null,
        shipper: { tenantId: sourcing.tenantId, name: shipperName ?? null },
        loadingContact: { name: load.loadingContactName, phone: load.loadingContactPhone },
        receiver: { name: load.unloadingContactName, phone: load.unloadingContactPhone },
      },
      claim: claim
        ? { status: claim.status, issue: claim.issue, agreedAmount: claim.agreedAmount }
        : null,
      originalPod: originalPod
        ? { status: originalPod.status, penalty: originalPod.penaltyAmount }
        : null,
      latestEvents: events.slice(-15).reverse(),
    };
  }

  // --- Super Admin approvals (S01) -----------------------------------------------------------

  async approvals() {
    const payments = await this.repository.partnerPayments.find({
      where: { status: In(['raised', 'on_hold']) },
      order: { raisedAt: 'ASC' },
      take: 200,
    });
    const now = this.now();
    const items = [];
    for (const payment of payments) {
      const sourcing = await this.repository.findSourcingByLoad(payment.loadId);
      if (!sourcing) continue;
      const partner = sourcing.partner;
      items.push({
        payment,
        lines: payment.lines ?? [],
        why:
          payment.paymentType === 'advance'
            ? 'Carrier advance raised by Tracking once the loading papers were approved'
            : 'Carrier balance raised by Payables on the original POD',
        payTo: partner
          ? {
              name: partner.name,
              bankAccountNumber: partner.bankAccountNumber,
              bankIfsc: partner.bankIfsc,
              upiId: partner.upiId,
              // No penny-drop check on carriers in this build.
              pennyDrop: null,
            }
          : null,
        load: {
          id: sourcing.loadId,
          code: sourcing.load.code,
          tenantId: sourcing.tenantId,
          status: sourcing.load.status,
        },
        waitingHours: payment.raisedAt
          ? Math.floor((now.getTime() - payment.raisedAt.getTime()) / 3_600_000)
          : null,
      });
    }
    // "Every charge Tracking raises up to the POD also reaches Super Admin straight away."
    const charges = await this.repository.charges.find({
      where: {
        raisedByParty: 'loadsmart',
        createdAt: MoreThanOrEqual(new Date(now.getTime() - 7 * DAY_MS)),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return {
      advances: items.filter((item) => item.payment.paymentType === 'advance'),
      balances: items.filter((item) => item.payment.paymentType === 'balance'),
      cancellations: await this.cancellationRequests(),
      recentCharges: charges,
    };
  }

  /** Shippers' cancellations of loads Loadsmart has won, waiting for Super Admin. */
  async cancellationRequests() {
    const rows = await this.loadCancel.listPending();
    const now = this.now();
    return rows.map((row) => ({
      cancellation: { ...row, load: undefined },
      load: row.load
        ? {
            id: row.load.id,
            code: row.load.code,
            tenantId: row.load.tenantId,
            status: row.load.status,
            vehicleNumber: row.load.vehicleNumber,
          }
        : null,
      waitingHours: Math.floor((now.getTime() - row.createdAt.getTime()) / 3_600_000),
    }));
  }

  decideCancellation(
    actorId: string,
    cancellationId: string,
    input: { decision: 'approved' | 'rejected'; note?: string },
  ) {
    return this.loadCancel.decide(actorId, cancellationId, input);
  }

  // --- Analytics (S02) -----------------------------------------------------------------------

  async analytics(from: Date, to: Date) {
    const before = previousPeriod(from, to);
    const [current, previous, settings] = await Promise.all([
      this.consoleRepository.tiles(from, to),
      this.consoleRepository.tiles(before.from, before.to),
      this.settings.current(),
    ]);
    const tile = (now: number, then: number) => ({
      value: now,
      previous: then,
      changePercent: changePercent(now, then),
    });
    const margin = (tiles: typeof current) => marginPercent(tiles.shipperTrip, tiles.carrierTrip);
    const placedPct = (tiles: typeof current) =>
      tiles.posted ? Math.round((tiles.placed / tiles.posted) * 1000) / 10 : null;
    const onTimePct = (tiles: typeof current) =>
      tiles.deliveredWithPromise
        ? Math.round((tiles.deliveredOnTime / tiles.deliveredWithPromise) * 1000) / 10
        : null;

    const [perDay, funnel, steps, stages, lanes, money, shippers] = await Promise.all([
      this.consoleRepository.postedPerDay(from, to),
      this.consoleRepository.funnel(from, to),
      this.consoleRepository.stepMedians(from, to),
      this.consoleRepository.stageMedians(from, to),
      this.consoleRepository.marginByLane(from, to),
      this.consoleRepository.moneyPosition(from, to),
      this.consoleRepository.topShippers(from, to),
    ]);
    const today = istDateOf(this.now());
    const ageing = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, 0])) as Record<
      AgeingBucket,
      number
    >;
    for (const invoice of money.open) {
      if (invoice.amount > 0) ageing[ageingBucket(invoice.dueDate, today)] += invoice.amount;
    }

    return {
      period: { from, to, previous: before },
      tiles: {
        posted: tile(current.posted, previous.posted),
        placed: { ...tile(current.placed, previous.placed), percentOfPosted: placedPct(current) },
        billed: {
          ...tile(current.billedCount, previous.billedCount),
          amount: round2(current.billedAmount),
        },
        grossMargin: {
          percent: margin(current),
          previous: margin(previous),
          target: settings.values.centralMarginPercent,
        },
        hoursToPlace: {
          value: current.medianHoursToPlace === null ? null : round2(current.medianHoursToPlace),
          previous:
            previous.medianHoursToPlace === null ? null : round2(previous.medianHoursToPlace),
        },
        onTime: { percent: onTimePct(current), previous: onTimePct(previous) },
      },
      postedPerDay: perDay,
      funnel,
      // Targets per step are not in settings yet.
      stepMedianHours: steps,
      stageMedianHours: stages,
      marginByLane: lanes.map((lane) => ({
        ...lane,
        marginPercent: marginPercent(lane.shipperTrip, lane.carrierTrip),
      })),
      moneyPosition: {
        receivablesByAge: Object.fromEntries(
          Object.entries(ageing).map(([bucket, amount]) => [bucket, round2(amount)]),
        ),
        medianDaysToCollect: money.medianDaysToCollect,
        paidToCarriers: money.paidToCarriers,
      },
      topShippers: shippers.map((row) => ({
        tenantId: row.tenantId,
        shipperName: row.shipperName,
        posted: row.posted,
        placementRate: row.posted ? Math.round((row.placed / row.posted) * 1000) / 10 : null,
        billed: round2(row.billed),
        marginPercent: marginPercent(row.shipperTrip, row.carrierTrip),
        medianDaysToPay:
          row.medianDaysToPay === null ? null : Math.round(Number(row.medianDaysToPay) * 10) / 10,
      })),
    };
  }

  // --- Live map (T07) ------------------------------------------------------------------------

  async liveMap(query: { q?: string; status?: LiveStatus[] }) {
    const rows = await this.consoleRepository.allLoads({ status: LIVE_STAGES, q: query.q }, 500);
    const live = rows.filter((row) => row.sourcingStatus === 'won');
    const now = this.now();
    const results: {
      loadId: string;
      code: string;
      tenantId: string;
      stage: LoadStatus;
      vehicleNumber: string | null;
      driver: { name: string | null; phone: string | null };
      position: { lat: number; lng: number; recordedAt: Date; placeName: string | null } | null;
      eta: { etaAt: Date; remainingKm: number; projectedDelayMin: number | null } | null;
      liveStatus: LiveStatus;
      needs: string[];
    }[] = [];
    for (let i = 0; i < live.length; i += TRACKING_CONCURRENCY) {
      const batch = live.slice(i, i + TRACKING_CONCURRENCY);
      const trips = await Promise.all(
        batch.map((row) =>
          this.trackingClient
            .getTrip(row.tenantId, row.loadId)
            .catch(() => ({ eta: null, position: null })),
        ),
      );
      for (const [index, row] of batch.entries()) {
        const trip = trips[index];
        const needs = await this.needsFromTracking(row);
        const status = liveStatus(
          {
            position: trip.position,
            pendingAction: needs.length > 0,
            runningLate: (trip.eta?.projectedDelayMin ?? 0) > 0 && !trip.eta?.stale,
          },
          now,
        );
        results.push({
          loadId: row.loadId,
          code: row.code,
          tenantId: row.tenantId,
          stage: row.status,
          vehicleNumber: row.vehicleNumber,
          driver: { name: row.driverName, phone: row.driverNumber },
          position: trip.position
            ? {
                lat: trip.position.lat,
                lng: trip.position.lng,
                recordedAt: trip.position.recordedAt,
                placeName: trip.position.placeName,
              }
            : null,
          eta: trip.eta
            ? {
                etaAt: trip.eta.etaAt,
                remainingKm: trip.eta.remainingKm,
                projectedDelayMin: trip.eta.projectedDelayMin,
              }
            : null,
          liveStatus: status,
          needs,
        });
      }
    }
    const filtered = query.status?.length
      ? results.filter((item) => query.status!.includes(item.liveStatus))
      : results;
    const counts: Partial<Record<LiveStatus, number>> = {};
    for (const item of results) counts[item.liveStatus] = (counts[item.liveStatus] ?? 0) + 1;
    return { counts, items: filtered };
  }

  /** What waits on Tracking for a live load. */
  private async needsFromTracking(row: AllLoadsRow): Promise<string[]> {
    const needs: string[] = [];
    if (row.status === 'reached_loading') needs.push('loading papers to review');
    if (row.status === 'reached_unloading') needs.push('POD to decide');
    if (row.status === 'in_transit_unloading' || row.status === 'loaded') {
      const load = await this.repository.findSourcingByLoad(row.loadId);
      if (load && !load.load.unloadingContactPhone && !load.load.unloadingAppointmentId) {
        needs.push('unloading details');
      }
    }
    return needs;
  }

  private teamOf(row: AllLoadsRow): ConsoleTeam {
    return teamHolding({
      sourcingStatus: row.sourcingStatus,
      loadStatus: row.status,
      claimOpen: row.claimStatus === 'open',
      invoiceStatus: row.invoiceStatus,
      carrierBalancePaid: row.balanceStatus === 'paid',
    });
  }

  private money(
    see: ReturnType<typeof moneyVisibility>,
    shipperTrip: number | string | null,
    carrierTrip: number | string | null,
  ) {
    const shipper = shipperTrip === null ? null : Number(shipperTrip);
    const carrier = carrierTrip === null ? null : Number(carrierTrip);
    return {
      ...(see.shipper ? { shipperFreight: shipper } : {}),
      ...(see.carrier ? { carrierFreight: carrier } : {}),
      ...(see.margin
        ? {
            margin: shipper !== null && carrier !== null ? round2(shipper - carrier) : null,
            marginPercent:
              shipper !== null && carrier !== null ? marginPercent(shipper, carrier) : null,
          }
        : {}),
    };
  }
}
