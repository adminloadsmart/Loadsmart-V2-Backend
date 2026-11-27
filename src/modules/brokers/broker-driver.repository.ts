import { DataSource, Repository } from 'typeorm';
import { BrokerDriverEntity, type BrokerDriverStatus } from './broker-driver.entity';

export interface BrokerDriverFilters {
  brokerId?: string;
  status?: BrokerDriverStatus;
  search?: string;
}

/** One row of the Drivers list, with the latest Sarathi check and the load figures. */
export interface BrokerDriverRow {
  id: string;
  brokerId: string;
  brokerName: string;
  fullName: string;
  mobile: string;
  isOnWhatsapp: boolean;
  licenceNumber: string;
  dateOfBirth: string | null;
  status: BrokerDriverStatus;
  note: string | null;
  licenceFrontFileKey: string | null;
  licenceBackFileKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  checkStatus: 'passed' | 'failed' | 'unavailable' | null;
  checkSource: 'portal' | 'manual' | null;
  checkDetails: Record<string, unknown> | null;
  checkFailures: string[] | null;
  checkedAt: Date | null;
  licenceValidUntil: string | null;
  totalLoads: number;
  loadsLast30Days: number;
  lastLoadId: string | null;
  lastLoadCode: string | null;
  lastLoadAt: Date | null;
  lastVehicleNumber: string | null;
}

export interface BrokerDriverTotals {
  all: number;
  active: number;
  inactive: number;
  verified: number;
  expiringIn30Days: number;
  needsAttention: number;
  onWhatsapp: number;
}

export interface BrokerDriverLoadRow {
  loadId: string;
  code: string;
  status: string;
  fromCity: string | null;
  toCity: string | null;
  vehicleNumber: string | null;
  namedAt: Date;
  memoAcceptedAt: Date | null;
}

export interface BrokerDriverCheckRow {
  id: string;
  loadId: string;
  loadCode: string | null;
  status: 'passed' | 'failed' | 'unavailable';
  source: 'portal' | 'manual';
  failures: string[];
  notes: string[];
  details: Record<string, unknown> | null;
  checkedAt: Date;
}

/** What Placement saved on the load when it named the driver. */
export interface PlacedDriver {
  partnerId: string;
  fullName: string;
  mobile: string;
  licenceNumber: string;
  dateOfBirth: string | null;
  licenceFrontFileKey?: string | null;
  licenceBackFileKey?: string | null;
  actorId: string | null;
}

/** When the driver was put on the load — the sourcing's "driver named" time, else the load's. */
const NAMED_AT = 'COALESCE(s.driver_named_at, l.created_at)';

/** The latest Sarathi (or manual) check of the licence, on any load. */
const LATEST_CHECK = `
  LEFT JOIN LATERAL (
    SELECT lv.status, lv.source, lv.details, lv.failures, lv.checked_at,
           CASE WHEN lv.details ->> 'validUntil' ~ '^\\d{4}-\\d{2}-\\d{2}$'
                THEN (lv.details ->> 'validUntil')::date END AS valid_until
      FROM loads.load_verifications lv
     WHERE lv.subject = 'driver' AND lv.subject_ref = d.licence_number
     ORDER BY lv.checked_at DESC
     LIMIT 1
  ) v ON true`;

/** The loads this broker placed with this driver. */
const LOAD_FIGURES = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS total_loads,
           COUNT(*) FILTER (WHERE ${NAMED_AT} >= now() - interval '30 days')::int AS loads_30d,
           (array_agg(l.id::text ORDER BY ${NAMED_AT} DESC))[1] AS last_load_id,
           (array_agg(l.code ORDER BY ${NAMED_AT} DESC))[1] AS last_load_code,
           MAX(${NAMED_AT}) AS last_load_at,
           (array_agg(l.vehicle_number ORDER BY ${NAMED_AT} DESC)
              FILTER (WHERE l.vehicle_number IS NOT NULL))[1] AS last_vehicle
      FROM loads.loads l
      JOIN loads.ls_sourcings s ON s.load_id = l.id
      JOIN loads.ls_partners p ON p.id = s.partner_id
     WHERE l.driver_licence_number = d.licence_number AND p.broker_id = d.broker_id
  ) ld ON true`;

const ROW_COLUMNS = `
  d.id, d.broker_id AS "brokerId", b.trucker_company AS "brokerName",
  d.full_name AS "fullName", d.mobile, d.is_on_whatsapp AS "isOnWhatsapp",
  d.licence_number AS "licenceNumber", to_char(d.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth",
  d.status, d.note,
  d.licence_front_file_key AS "licenceFrontFileKey", d.licence_back_file_key AS "licenceBackFileKey",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt",
  v.status AS "checkStatus", v.source AS "checkSource", v.details AS "checkDetails",
  v.failures AS "checkFailures", v.checked_at AS "checkedAt",
  to_char(v.valid_until, 'YYYY-MM-DD') AS "licenceValidUntil",
  COALESCE(ld.total_loads, 0) AS "totalLoads", COALESCE(ld.loads_30d, 0) AS "loadsLast30Days",
  ld.last_load_id AS "lastLoadId", ld.last_load_code AS "lastLoadCode",
  ld.last_load_at AS "lastLoadAt", ld.last_vehicle AS "lastVehicleNumber"`;

export class BrokerDriverRepository {
  readonly drivers: Repository<BrokerDriverEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.drivers = dataSource.getRepository(BrokerDriverEntity);
  }

  /** Drivers matching the filters, name A–Z. No `page` = every match. */
  async list(
    filters: BrokerDriverFilters,
    page?: { page: number; limit: number },
  ): Promise<[BrokerDriverRow[], number]> {
    const { where, params } = this.where(filters);
    const paging = page
      ? `LIMIT ${Number(page.limit)} OFFSET ${(Number(page.page) - 1) * Number(page.limit)}`
      : '';
    const [rows, count] = await Promise.all([
      this.dataSource.query(
        `SELECT ${ROW_COLUMNS}
           FROM brokers.broker_drivers d
           JOIN brokers.brokers b ON b.id = d.broker_id
           ${LATEST_CHECK}
           ${LOAD_FIGURES}
          ${where}
          ORDER BY lower(d.full_name), d.id
          ${paging}`,
        params,
      ) as Promise<BrokerDriverRow[]>,
      this.dataSource.query(
        `SELECT COUNT(*)::int AS n
           FROM brokers.broker_drivers d
           JOIN brokers.brokers b ON b.id = d.broker_id
          ${where}`,
        params,
      ) as Promise<{ n: number }[]>,
    ]);
    return [rows, count[0]?.n ?? 0];
  }

  async findRow(id: string): Promise<BrokerDriverRow | null> {
    const rows: BrokerDriverRow[] = await this.dataSource.query(
      `SELECT ${ROW_COLUMNS}
         FROM brokers.broker_drivers d
         JOIN brokers.brokers b ON b.id = d.broker_id
         ${LATEST_CHECK}
         ${LOAD_FIGURES}
        WHERE d.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** The summary cards and tab counts — across every driver (of the broker, when given). */
  async totals(brokerId?: string): Promise<BrokerDriverTotals> {
    const rows: Record<string, number>[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS "all",
              COUNT(*) FILTER (WHERE d.status = 'active')::int AS active,
              COUNT(*) FILTER (WHERE d.status = 'inactive')::int AS inactive,
              COUNT(*) FILTER (
                WHERE v.status = 'passed' AND (v.valid_until IS NULL OR v.valid_until >= current_date)
              )::int AS verified,
              COUNT(*) FILTER (
                WHERE v.valid_until BETWEEN current_date AND current_date + 30
              )::int AS expiring,
              COUNT(*) FILTER (
                WHERE v.status IS NULL OR v.status <> 'passed' OR v.valid_until < current_date
              )::int AS attention,
              COUNT(*) FILTER (WHERE d.is_on_whatsapp)::int AS "onWhatsapp"
         FROM brokers.broker_drivers d
         ${LATEST_CHECK}
        ${brokerId ? 'WHERE d.broker_id = $1' : ''}`,
      brokerId ? [brokerId] : [],
    );
    const r = rows[0] ?? {};
    return {
      all: r.all ?? 0,
      active: r.active ?? 0,
      inactive: r.inactive ?? 0,
      verified: r.verified ?? 0,
      expiringIn30Days: r.expiring ?? 0,
      needsAttention: r.attention ?? 0,
      onWhatsapp: r.onWhatsapp ?? 0,
    };
  }

  /** The loads this broker placed with this driver, latest first. */
  loads(brokerId: string, licenceNumber: string, limit: number): Promise<BrokerDriverLoadRow[]> {
    return this.dataSource.query(
      `SELECT l.id AS "loadId", l.code, l.status::text AS status,
              lp.pickup_address ->> 'city' AS "fromCity",
              lp.drop_address ->> 'city' AS "toCity",
              l.vehicle_number AS "vehicleNumber",
              ${NAMED_AT} AS "namedAt",
              l.memo_accepted_at AS "memoAcceptedAt"
         FROM loads.loads l
         JOIN loads.ls_sourcings s ON s.load_id = l.id
         JOIN loads.ls_partners p ON p.id = s.partner_id
         LEFT JOIN loads.load_postings lp ON lp.id = l.posting_id
        WHERE l.driver_licence_number = $1 AND p.broker_id = $2
        ORDER BY ${NAMED_AT} DESC
        LIMIT ${Number(limit)}`,
      [licenceNumber, brokerId],
    );
  }

  /** The licence's checks on Sarathi (and by hand), latest first. */
  checks(licenceNumber: string, limit: number): Promise<BrokerDriverCheckRow[]> {
    return this.dataSource.query(
      `SELECT lv.id, lv.load_id AS "loadId", l.code AS "loadCode", lv.status, lv.source,
              lv.failures, lv.notes, lv.details, lv.checked_at AS "checkedAt"
         FROM loads.load_verifications lv
         LEFT JOIN loads.loads l ON l.id = lv.load_id
        WHERE lv.subject = 'driver' AND lv.subject_ref = $1
        ORDER BY lv.checked_at DESC
        LIMIT ${Number(limit)}`,
      [licenceNumber],
    );
  }

  /**
   * Placement named a driver on a load a broker won: adds the driver under that broker, or
   * refreshes the name, mobile, date of birth and photos when the licence is already there. A
   * partner with no broker-master row (a fleet owner) is skipped.
   */
  async upsertFromPlacement(d: PlacedDriver): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO brokers.broker_drivers AS bd
         (broker_id, full_name, mobile, licence_number, date_of_birth,
          licence_front_file_key, licence_back_file_key, created_by, updated_by)
       SELECT p.broker_id, $2, $3, $4, $5::date, $6, $7, $8::uuid, $8::uuid
         FROM loads.ls_partners p
        WHERE p.id = $1 AND p.broker_id IS NOT NULL
       ON CONFLICT (broker_id, licence_number) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         mobile = EXCLUDED.mobile,
         date_of_birth = COALESCE(EXCLUDED.date_of_birth, bd.date_of_birth),
         licence_front_file_key = COALESCE(EXCLUDED.licence_front_file_key, bd.licence_front_file_key),
         licence_back_file_key = COALESCE(EXCLUDED.licence_back_file_key, bd.licence_back_file_key),
         updated_by = COALESCE(EXCLUDED.updated_by, bd.updated_by),
         updated_at = now()`,
      [
        d.partnerId,
        d.fullName,
        d.mobile,
        d.licenceNumber,
        d.dateOfBirth,
        d.licenceFrontFileKey ?? null,
        d.licenceBackFileKey ?? null,
        d.actorId,
      ],
    );
  }

  private where({ brokerId, status, search }: BrokerDriverFilters) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (brokerId) {
      params.push(brokerId);
      clauses.push(`d.broker_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`d.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const n = `$${params.length}`;
      clauses.push(
        `(d.full_name ILIKE ${n} OR d.mobile ILIKE ${n} OR d.licence_number ILIKE ${n}
          OR b.trucker_company ILIKE ${n})`,
      );
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
}
