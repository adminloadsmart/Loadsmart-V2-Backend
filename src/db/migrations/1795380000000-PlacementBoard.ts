import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

/**
 * Placement console: every broker response logged on a load (bid history), brokers added to a
 * load's matched list by hand, the broker and quoted rate on a call, when the requirement went
 * out, and hours added to a posting's bid window.
 */
export class PlacementBoard1795380000000 implements MigrationInterface {
  name = 'PlacementBoard1795380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        schema: 'loads',
        name: 'ls_partner_bid_responses',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'sourcing_id', type: 'uuid' },
          { name: 'partner_id', type: 'uuid' },
          { name: 'response', type: 'varchar', length: '20' },
          { name: 'rate', type: 'numeric', precision: 12, scale: 2, isNullable: true },
          { name: 'channel', type: 'varchar', length: '20' },
          { name: 'note', type: 'varchar', length: '500', isNullable: true },
          { name: 'vehicle_number', type: 'varchar', length: '20', isNullable: true },
          { name: 'entered_by', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        indices: [
          new TableIndex({
            name: 'ls_partner_bid_responses_sourcing_partner_idx',
            columnNames: ['sourcing_id', 'partner_id'],
          }),
        ],
      }),
    );
    await queryRunner.createTable(
      new Table({
        schema: 'loads',
        name: 'ls_sourcing_brokers',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'sourcing_id', type: 'uuid' },
          { name: 'partner_id', type: 'uuid' },
          { name: 'added_by', type: 'uuid' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        uniques: [
          new TableUnique({
            name: 'ls_sourcing_brokers_sourcing_partner_uq',
            columnNames: ['sourcing_id', 'partner_id'],
          }),
        ],
      }),
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_call_logs" ADD "partner_id" uuid`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_call_logs" ADD "quoted_rate" numeric(12,2)`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "requirement_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "requirement_sent_count" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD "bid_window_extra_minutes" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" DROP COLUMN "bid_window_extra_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" DROP COLUMN "requirement_sent_count"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_sourcings" DROP COLUMN "requirement_sent_at"`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_call_logs" DROP COLUMN "quoted_rate"`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_call_logs" DROP COLUMN "partner_id"`);
    await queryRunner.dropTable('loads.ls_sourcing_brokers', true);
    await queryRunner.dropTable('loads.ls_partner_bid_responses', true);
  }
}
