import { DataSource } from 'typeorm';
import { LoadStatus } from '../loads/utils/loads.types';
import { InvoiceStatus, PartnerPaymentStatus, SourcingStatus } from './loadsmart.types';

/** A trip amount in SQL: per-ton rates times the planned tonnes, flat rates as they are. */
const trip = (rate: string) =>
  `(CASE WHEN l."freight_type" = 'per_ton' THEN ${rate} * l."planned_capacity_tonnes" ELSE ${rate} END)`;

export interface AllLoadsRow {
  sourcingId: string;
  sourcingStatus: SourcingStatus;
  tenantId: string;
  shipperName: string | null;
  loadId: string;
  code: string;
  status: LoadStatus;
  vehicleNumber: string | null;
  driverName: string | null;
  driverNumber: string | null;
  fromCity: string | null;
  toCity: string | null;
  pickupAt: Date | null;
  partnerName: string | null;
  shipperTrip: string | null;
  carrierTrip: string | null;
  claimStatus: string | null;
  invoiceStatus: InvoiceStatus | null;
  advanceStatus: PartnerPaymentStatus | null;
  balanceStatus: PartnerPaymentStatus | null;
  lastStageAt: Date | null;
  updatedAt: Date;
}

export interface AllLoadsFilter {
  status?: LoadStatus[];
  tenantId?: string;
  /** Load code, vehicle number or driver mobile. */
  q?: string;
}

export interface PeriodTiles {
  posted: number;
  placed: number;
  billedCount: number;
  billedAmount: number;
  shipperTrip: number;
  carrierTrip: number;
  medianHoursToPlace: number | null;
  deliveredWithPromise: number;
  deliveredOnTime: number;
}

/**
 * Read-only SQL for the console's cross-team views — every Loadsmart load (one with a sourcing)
 * across shippers. Kept apart from LoadsmartRepository, which the services write through.
 */
export class ConsoleRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** L01, newest activity first, at most `cap` rows (the team filter runs after). */
  async allLoads(filter: AllLoadsFilter, cap = 2000): Promise<AllLoadsRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status?.length) {
      params.push(filter.status);
      where.push(`l."status" = ANY($${params.length})`);
    }
    if (filter.tenantId) {
      params.push(filter.tenantId);
      where.push(`s."tenant_id" = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q.replace(/[%_]/g, '')}%`);
      const p = `$${params.length}`;
      where.push(
        `(l."code" ILIKE ${p} OR l."vehicle_number" ILIKE ${p} OR l."driver_number" ILIKE ${p})`,
      );
    }
    params.push(cap);
    return (await this.dataSource.query(
      `SELECT s."id" AS "sourcingId", s."status" AS "sourcingStatus", s."tenant_id" AS "tenantId",
              o."name" AS "shipperName", l."id" AS "loadId", l."code", l."status",
              l."vehicle_number" AS "vehicleNumber", l."driver_name" AS "driverName",
              l."driver_number" AS "driverNumber",
              p."pickup_address"->>'city' AS "fromCity", p."drop_address"->>'city' AS "toCity",
              p."pickup_at" AS "pickupAt", pa."name" AS "partnerName",
              ROUND(${trip('l."freight_value"')}, 2) AS "shipperTrip",
              ROUND(${trip('s."partner_rate"')}, 2) AS "carrierTrip",
              c."status" AS "claimStatus", i."status" AS "invoiceStatus",
              adv."status" AS "advanceStatus", bal."status" AS "balanceStatus",
              (SELECT MAX(h."entered_at") FROM "loads"."load_stage_history" h
                WHERE h."load_id" = l."id") AS "lastStageAt",
              l."updated_at" AS "updatedAt"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         LEFT JOIN "loads"."load_postings" p ON p."id" = l."posting_id"
         LEFT JOIN "auth"."organizations" o ON o."id" = s."tenant_id"
         LEFT JOIN "loads"."ls_partners" pa ON pa."id" = s."partner_id"
         LEFT JOIN "loads"."load_claims" c ON c."load_id" = l."id"
         LEFT JOIN "loads"."ls_invoices" i ON i."load_id" = l."id"
         LEFT JOIN "loads"."ls_partner_payments" adv
                ON adv."sourcing_id" = s."id" AND adv."payment_type" = 'advance'
         LEFT JOIN "loads"."ls_partner_payments" bal
                ON bal."sourcing_id" = s."id" AND bal."payment_type" = 'balance'
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l."updated_at" DESC
        LIMIT $${params.length}`,
      params,
    )) as AllLoadsRow[];
  }

  async shipperName(tenantId: string): Promise<string | null> {
    const rows = (await this.dataSource.query(
      `SELECT "name" FROM "auth"."organizations" WHERE "id" = $1`,
      [tenantId],
    )) as { name: string | null }[];
    return rows[0]?.name ?? null;
  }

  // --- Analytics (S02) -------------------------------------------------------------------------

  /** The headline tiles for loads posted in [from, to) — billed by invoice date. */
  async tiles(from: Date, to: Date): Promise<PeriodTiles> {
    const [posted] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "posted",
              COUNT(*) FILTER (WHERE s."status" = 'won' AND l."memo_accepted_at" IS NOT NULL)::int AS "placed",
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (l."memo_accepted_at" - l."created_at")) / 3600
              ) FILTER (WHERE l."memo_accepted_at" IS NOT NULL) AS "medianHoursToPlace"
         FROM "loads"."ls_sourcings" s JOIN "loads"."loads" l ON l."id" = s."load_id"
        WHERE l."created_at" >= $1 AND l."created_at" < $2`,
      [from, to],
    )) as { posted: number; placed: number; medianHoursToPlace: number | null }[];
    const [billed] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "billedCount", COALESCE(SUM(i."total_amount"), 0)::float AS "billedAmount",
              COALESCE(SUM(${trip('l."freight_value"')}), 0)::float AS "shipperTrip",
              COALESCE(SUM(${trip('s."partner_rate"')}), 0)::float AS "carrierTrip"
         FROM "loads"."ls_invoices" i
         JOIN "loads"."loads" l ON l."id" = i."load_id"
         JOIN "loads"."ls_sourcings" s ON s."load_id" = l."id"
        WHERE i."created_at" >= $1 AND i."created_at" < $2`,
      [from, to],
    )) as { billedCount: number; billedAmount: number; shipperTrip: number; carrierTrip: number }[];
    const [onTime] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "deliveredWithPromise",
              COUNT(*) FILTER (WHERE l."delivered_at" <= p."deliver_by_at")::int AS "deliveredOnTime"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         JOIN "loads"."load_postings" p ON p."id" = l."posting_id"
        WHERE s."status" = 'won' AND p."deliver_by_at" IS NOT NULL
          AND l."delivered_at" >= $1 AND l."delivered_at" < $2`,
      [from, to],
    )) as { deliveredWithPromise: number; deliveredOnTime: number }[];
    return {
      posted: posted.posted,
      placed: posted.placed,
      medianHoursToPlace:
        posted.medianHoursToPlace === null ? null : Number(posted.medianHoursToPlace),
      ...billed,
      ...onTime,
    };
  }

  /** Loads posted per IST day. */
  postedPerDay(from: Date, to: Date): Promise<{ day: string; posted: number }[]> {
    return this.dataSource.query(
      `SELECT to_char(l."created_at" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS "day",
              COUNT(*)::int AS "posted"
         FROM "loads"."ls_sourcings" s JOIN "loads"."loads" l ON l."id" = s."load_id"
        WHERE l."created_at" >= $1 AND l."created_at" < $2
        GROUP BY 1 ORDER BY 1`,
      [from, to],
    );
  }

  /** How far the loads posted in the period got. */
  async funnel(from: Date, to: Date): Promise<Record<string, number>> {
    const [row] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS "posted",
              COUNT(*) FILTER (WHERE s."bid_sent_at" IS NOT NULL)::int AS "priceSent",
              COUNT(*) FILTER (WHERE s."status" = 'won')::int AS "won",
              COUNT(*) FILTER (WHERE l."memo_accepted_at" IS NOT NULL)::int AS "memoAccepted",
              COUNT(*) FILTER (WHERE l."loading_confirmed_at" IS NOT NULL)::int AS "loaded",
              COUNT(*) FILTER (WHERE l."delivered_at" IS NOT NULL)::int AS "delivered",
              COUNT(i."id")::int AS "invoiced",
              COUNT(*) FILTER (WHERE l."status" = 'closed')::int AS "closed"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         LEFT JOIN "loads"."ls_invoices" i ON i."load_id" = l."id"
        WHERE l."created_at" >= $1 AND l."created_at" < $2`,
      [from, to],
    )) as Record<string, number>[];
    return row;
  }

  /** Median hours of each team's step, for steps that finished in the period. */
  async stepMedians(from: Date, to: Date): Promise<Record<string, number | null>> {
    const median = (start: string, end: string) =>
      `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${end} - ${start})) / 3600)
         FILTER (WHERE ${start} IS NOT NULL AND ${end} >= $1 AND ${end} < $2)`;
    const [row] = (await this.dataSource.query(
      `SELECT ${median('l."created_at"', 'b."decided_at"')} AS "postedToPriceHeld",
              ${median('b."decided_at"', 'l."memo_accepted_at"')} AS "priceHeldToMemoAccepted",
              ${median('rl."entered_at"', 'l."ls_papers_approved_at"')} AS "papersToApproved",
              ${median('pod."created_at"', 'i."created_at"')} AS "podImageToInvoice",
              ${median('l."loading_confirmed_at"', 'adv."paid_at"')} AS "loadingToAdvancePaid",
              ${median('l."delivered_at"', 'op."filed_at"')} AS "deliveryToOriginalPodFiled"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         LEFT JOIN "loads"."load_bids" b ON b."id" = l."awarded_bid_id"
         LEFT JOIN LATERAL (
           SELECT h."entered_at" FROM "loads"."load_stage_history" h
            WHERE h."load_id" = l."id" AND h."stage" = 'reached_loading'
            ORDER BY h."entered_at" DESC LIMIT 1) rl ON true
         LEFT JOIN LATERAL (
           SELECT d."created_at" FROM "loads"."load_documents" d
            WHERE d."load_id" = l."id" AND d."doc_type" = 'pod_front'
            ORDER BY d."version" ASC LIMIT 1) pod ON true
         LEFT JOIN "loads"."ls_invoices" i ON i."load_id" = l."id"
         LEFT JOIN "loads"."ls_partner_payments" adv
                ON adv."sourcing_id" = s."id" AND adv."payment_type" = 'advance' AND adv."status" = 'paid'
         LEFT JOIN "loads"."ls_original_pods" op ON op."load_id" = l."id"
        WHERE s."status" = 'won'`,
      [from, to],
    )) as Record<string, string | null>[];
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value === null ? null : Math.round(Number(value) * 10) / 10,
      ]),
    );
  }

  /** Median hours a Loadsmart load spends at each stage (stage-history rows that closed in the
   *  period). */
  stageMedians(
    from: Date,
    to: Date,
  ): Promise<{ stage: LoadStatus; medianHours: number; loads: number }[]> {
    return this.dataSource
      .query(
        `SELECT h."stage",
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM (h."exited_at" - h."entered_at")) / 3600
                ) AS "medianHours",
                COUNT(*)::int AS "loads"
           FROM "loads"."load_stage_history" h
          WHERE h."route" = 'loadsmart' AND h."exited_at" >= $1 AND h."exited_at" < $2
          GROUP BY h."stage"`,
        [from, to],
      )
      .then((rows: { stage: LoadStatus; medianHours: string; loads: number }[]) =>
        rows.map((row) => ({
          ...row,
          medianHours: Math.round(Number(row.medianHours) * 10) / 10,
        })),
      );
  }

  /** Margin by lane for loads billed in the period. */
  marginByLane(from: Date, to: Date) {
    return this.dataSource.query(
      `SELECT p."pickup_address"->>'city' AS "fromCity", p."drop_address"->>'city' AS "toCity",
              COUNT(*)::int AS "loads",
              ROUND(SUM(${trip('l."freight_value"')}), 2)::float AS "shipperTrip",
              ROUND(SUM(${trip('s."partner_rate"')}), 2)::float AS "carrierTrip"
         FROM "loads"."ls_invoices" i
         JOIN "loads"."loads" l ON l."id" = i."load_id"
         JOIN "loads"."ls_sourcings" s ON s."load_id" = l."id"
         LEFT JOIN "loads"."load_postings" p ON p."id" = l."posting_id"
        WHERE i."created_at" >= $1 AND i."created_at" < $2
        GROUP BY 1, 2 ORDER BY "loads" DESC LIMIT 50`,
      [from, to],
    ) as Promise<
      {
        fromCity: string | null;
        toCity: string | null;
        loads: number;
        shipperTrip: number;
        carrierTrip: number;
      }[]
    >;
  }

  /** Open invoices (for the ageing view) and collection speed. */
  async moneyPosition(from: Date, to: Date) {
    const open = (await this.dataSource.query(
      `SELECT to_char("due_date", 'YYYY-MM-DD') AS "dueDate", COALESCE("open_amount", "balance_due")::float AS "amount"
         FROM "loads"."ls_invoices" WHERE "status" IN ('issued', 'partly_paid')`,
    )) as { dueDate: string | null; amount: number }[];
    const [collect] = (await this.dataSource.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM ("settled_at" - "received_on"::timestamptz)) / 86400
              ) AS "medianDaysToCollect"
         FROM "loads"."ls_invoices"
        WHERE "settled_at" >= $1 AND "settled_at" < $2 AND "received_on" IS NOT NULL`,
      [from, to],
    )) as { medianDaysToCollect: string | null }[];
    const paid = (await this.dataSource.query(
      `SELECT "payment_type" AS "paymentType", COALESCE(SUM("net_amount"), 0)::float AS "amount"
         FROM "loads"."ls_partner_payments"
        WHERE "status" = 'paid' AND "paid_at" >= $1 AND "paid_at" < $2
        GROUP BY 1`,
      [from, to],
    )) as { paymentType: string; amount: number }[];
    return {
      open,
      medianDaysToCollect:
        collect.medianDaysToCollect === null
          ? null
          : Math.round(Number(collect.medianDaysToCollect) * 10) / 10,
      paidToCarriers: Object.fromEntries(paid.map((row) => [row.paymentType, row.amount])),
    };
  }

  /** Top shippers by loads posted in the period. */
  topShippers(from: Date, to: Date) {
    return this.dataSource.query(
      `SELECT s."tenant_id" AS "tenantId", o."name" AS "shipperName",
              COUNT(*)::int AS "posted",
              COUNT(*) FILTER (WHERE l."memo_accepted_at" IS NOT NULL)::int AS "placed",
              COALESCE(SUM(i."total_amount"), 0)::float AS "billed",
              COALESCE(SUM(${trip('l."freight_value"')}) FILTER (WHERE i."id" IS NOT NULL), 0)::float AS "shipperTrip",
              COALESCE(SUM(${trip('s."partner_rate"')}) FILTER (WHERE i."id" IS NOT NULL), 0)::float AS "carrierTrip",
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (i."settled_at" - i."received_on"::timestamptz)) / 86400
              ) FILTER (WHERE i."settled_at" IS NOT NULL AND i."received_on" IS NOT NULL) AS "medianDaysToPay"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         LEFT JOIN "auth"."organizations" o ON o."id" = s."tenant_id"
         LEFT JOIN "loads"."ls_invoices" i ON i."load_id" = l."id"
        WHERE l."created_at" >= $1 AND l."created_at" < $2
        GROUP BY 1, 2 ORDER BY "posted" DESC LIMIT 10`,
      [from, to],
    ) as Promise<
      {
        tenantId: string;
        shipperName: string | null;
        posted: number;
        placed: number;
        billed: number;
        shipperTrip: number;
        carrierTrip: number;
        medianDaysToPay: string | null;
      }[]
    >;
  }
}
