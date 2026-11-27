import { paginate, Paginated } from '../../../shared/utils/pagination';
import { BrokerEntity } from './broker.entity';
import { BrokerRepository } from './broker.repository';
import type { BrokerStatus } from './broker.types';
import type { BrokerFilters, ListBrokersQuery } from './broker.validators';

export interface BrokerView {
  id: string;
  brokerName: string;
  contactName: string;
  phone: string;
  isOnWhatsapp: boolean;
  email: string | null;
  base: string;
  truckSources: string[];
  lane: { origin: string; destinations: string[]; label: string };
  tdsPercent: number;
  loadsLast30Days: number;
  rating: number | null;
  status: BrokerStatus;
  holdReason: string | null;
  pendingOriginalPods: number;
}

export interface BrokerListResponse extends Paginated<BrokerView> {
  summary: {
    approved: { count: number; placedLoadLast30Days: number };
    awaitingApproval: { count: number };
    onHold: { count: number };
    originalPodsPast15Days: { count: number; brokers: number };
    onWhatsapp: { count: number; notOnWhatsapp: number };
  };
  tabs: { all: number } & Record<BrokerStatus, number>;
}

const CSV_HEADER = [
  'Broker',
  'Contact',
  'Phone',
  'On WhatsApp',
  'Email',
  'Base',
  'Sources (trucks)',
  'Lanes',
  'TDS %',
  'Loads, 30 d',
  'Rating',
  'Status',
  'Hold reason',
  'Original PODs past 15 days',
];

export class BrokerService {
  constructor(private readonly repo: BrokerRepository) {}

  /** The Brokers page: one page of the list, plus the summary cards and tab counts. */
  async list(query: ListBrokersQuery): Promise<BrokerListResponse> {
    const { page, limit, status, search } = query;
    const [[rows, total], totals] = await Promise.all([
      this.repo.list({ status, search }, { page, limit }),
      this.repo.totals(),
    ]);
    return {
      ...paginate(rows.map(toBrokerView), total, { page, limit }),
      summary: {
        approved: {
          count: totals.byStatus.approved,
          placedLoadLast30Days: totals.withLoadsLast30Days,
        },
        awaitingApproval: { count: totals.byStatus.awaiting_approval },
        onHold: { count: totals.byStatus.on_hold },
        originalPodsPast15Days: {
          count: totals.pendingOriginalPods,
          brokers: totals.brokersWithPendingPods,
        },
        onWhatsapp: { count: totals.onWhatsapp, notOnWhatsapp: totals.notOnWhatsapp },
      },
      tabs: { all: totals.all, ...totals.byStatus },
    };
  }

  /** Every broker matching the filters, as CSV (Export CSV). */
  async exportCsv(filters: BrokerFilters): Promise<string> {
    const [rows] = await this.repo.list(filters);
    const lines = rows
      .map(toBrokerView)
      .map((b) =>
        [
          b.brokerName,
          b.contactName,
          b.phone,
          b.isOnWhatsapp ? 'Yes' : 'No',
          b.email ?? '',
          b.base,
          b.truckSources.join(', '),
          b.lane.label,
          b.tdsPercent,
          b.loadsLast30Days,
          b.rating ?? '',
          b.status,
          b.holdReason ?? '',
          b.pendingOriginalPods,
        ]
          .map(csvCell)
          .join(','),
      );
    return [CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n');
  }
}

export function toBrokerView(b: BrokerEntity): BrokerView {
  return {
    id: b.id,
    brokerName: b.truckerCompany,
    contactName: b.truckerName,
    phone: b.phone,
    isOnWhatsapp: b.isOnWhatsapp,
    email: b.email,
    base: b.base,
    truckSources: b.truckSources,
    lane: {
      origin: b.laneOrigin,
      destinations: b.laneDestinations,
      label: `${b.laneOrigin} → ${b.laneDestinations.join(', ')}`,
    },
    tdsPercent: Number(b.tdsPercent),
    loadsLast30Days: b.loadsLast30Days,
    rating: b.rating === null ? null : Number(b.rating),
    status: b.status,
    holdReason: b.holdReason,
    pendingOriginalPods: b.pendingOriginalPods,
  };
}

/** Quote a CSV cell; a leading = + - @ is prefixed so spreadsheets don't run it as a formula. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
