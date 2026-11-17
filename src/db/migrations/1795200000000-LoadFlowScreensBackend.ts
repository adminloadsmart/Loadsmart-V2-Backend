import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backend for the redesigned load-flow screens (Figma review, 17 Nov).
 *
 * - Bids: the shipper's counter-offer and the bidder's answer, a rejection reason, and every rate
 *   the bid has carried (the table shows only the latest).
 * - A toll/gate charge head.
 * - Shipper credit capped at 45 days (Loadsmart is MSME-registered), replacing "at most 10": a new
 *   settings version carries it, so loads posted under earlier versions keep theirs. New loads
 *   also get Loadsmart's bank account for Pay invoice (empty until Super Admin fills it in).
 */
export class LoadFlowScreensBackend1795200000000 implements MigrationInterface {
  name = 'LoadFlowScreensBackend1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of ['BID_COUNTERED', 'BID_COUNTER_ANSWERED', 'BID_REJECTED']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
    await queryRunner.query(
      `ALTER TYPE "loads"."load_charges_charge_type_enum" ADD VALUE IF NOT EXISTS 'toll'`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."load_bids_counter_status_enum" AS ENUM('pending', 'accepted', 'declined')`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_bids" ADD "counter_rate" numeric(12,2)`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "counter_note" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "counter_status" "loads"."load_bids_counter_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "countered_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_bids" ADD "countered_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "counter_answered_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_bids" ADD "counter_answered_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "rejection_reason" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids" ADD "rate_history" jsonb NOT NULL DEFAULT '[]'`,
    );
    // Bids already on file start their history with the rate they carry.
    await queryRunner.query(
      `UPDATE "loads"."load_bids"
          SET "rate_history" = jsonb_build_array(jsonb_build_object(
            'at', to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'by', "entered_by", 'kind', 'bid', 'rate', "rate"::text))`,
    );

    // A new settings version: the latest values with credit capped at 45 days.
    await queryRunner.query(
      `INSERT INTO "loads"."settings_versions" ("version", "settings", "note")
       SELECT v."version" + 1,
              v."settings" || jsonb_build_object(
                'maxShipperCreditDays', 45,
                'loadsmartPayee', jsonb_build_object(
                  'legalName', NULL, 'bankName', NULL, 'accountNumber', NULL,
                  'ifsc', NULL, 'upiId', NULL)),
              'Shipper credit capped at 45 days (MSME); Loadsmart bank account for Pay invoice'
         FROM "loads"."settings_versions" v
        ORDER BY v."version" DESC
        LIMIT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "loads"."settings_versions" v
        WHERE v."note" LIKE 'Shipper credit capped at 45 days%'
          AND NOT EXISTS (SELECT 1 FROM "loads"."loads" l WHERE l."settings_version_id" = v."id")`,
    );
    for (const column of [
      'rate_history',
      'rejection_reason',
      'counter_answered_by',
      'counter_answered_at',
      'countered_by',
      'countered_at',
      'counter_status',
      'counter_note',
      'counter_rate',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."load_bids" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "loads"."load_bids_counter_status_enum"`);
    // Toll charges have no head in the old shape: they become "other" (the enum values stay —
    // Postgres can't drop them).
    await queryRunner.query(
      `UPDATE "loads"."load_charges" SET "charge_type" = 'other', "note" = COALESCE("note", 'Toll/gate') WHERE "charge_type" = 'toll'`,
    );
  }
}
