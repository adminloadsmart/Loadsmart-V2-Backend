import { MigrationInterface, QueryRunner } from 'typeorm';

/** Foreign keys that deleted a load's (or posting's) records along with it. Loads are never
 *  deleted, and these records are the money and audit trail — so deleting the parent is refused. */
const RESTRICTED_FKS: [table: string, constraint: string, column: string, parent: string][] = [
  ['load_bids', 'FK_load_bids_load', 'load_id', 'loads'],
  ['load_memos', 'FK_load_memos_load', 'load_id', 'loads'],
  ['load_verifications', 'FK_load_verifications_load', 'load_id', 'loads'],
  ['ls_sourcings', 'FK_ls_sourcings_load', 'load_id', 'loads'],
  ['load_charges', 'FK_load_charges_load', 'load_id', 'loads'],
  ['load_claims', 'FK_load_claims_load', 'load_id', 'loads'],
  ['load_ratings', 'FK_load_ratings_load', 'load_id', 'loads'],
  ['ls_invoices', 'FK_ls_invoices_load', 'load_id', 'loads'],
  ['load_award_outcomes', 'FK_load_award_outcomes_load', 'load_id', 'loads'],
  ['ls_partner_bids', 'FK_ls_partner_bids_sourcing', 'sourcing_id', 'ls_sourcings'],
  ['ls_partner_payments', 'FK_ls_partner_payments_sourcing', 'sourcing_id', 'ls_sourcings'],
  ['load_recipients', 'FK_load_recipients_posting', 'posting_id', 'load_postings'],
];

/**
 * Load module Phase 1c:
 * - loads.load_stage_history — one row per stage a load entered (trigger, actor, channel, entered
 *   and exited), at most one open row per load. Existing loads get one open row for their current
 *   stage, entered at their last update.
 * - ON DELETE CASCADE → RESTRICT on the load's records.
 */
export class LoadStageHistory1794400000000 implements MigrationInterface {
  name = 'LoadStageHistory1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_stage_history_actor_type_enum" AS ENUM('shipper', 'driver', 'transporter', 'ls_team', 'system')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_stage_history_channel_enum" AS ENUM('web', 'driver_app', 'console', 'whatsapp', 'call', 'tracking', 'system')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."load_stage_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "stage" character varying(32) NOT NULL,
        "route" character varying(32),
        "trigger" character varying(40) NOT NULL,
        "actor_type" "loads"."load_stage_history_actor_type_enum" NOT NULL,
        "actor_id" uuid,
        "channel" "loads"."load_stage_history_channel_enum" NOT NULL,
        "entered_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "exited_at" TIMESTAMP WITH TIME ZONE,
        "metadata" jsonb,
        CONSTRAINT "PK_load_stage_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_stage_history_load" FOREIGN KEY ("load_id")
          REFERENCES "loads"."loads"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "load_stage_history_load_entered_idx" ON "loads"."load_stage_history" ("load_id", "entered_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_stage_history_one_open_per_load" ON "loads"."load_stage_history" ("load_id") WHERE "exited_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_stage_history_tenant_stage_idx" ON "loads"."load_stage_history" ("tenant_id", "stage", "entered_at")`,
    );
    await queryRunner.query(`
      INSERT INTO "loads"."load_stage_history"
        ("tenant_id", "load_id", "stage", "route", "trigger", "actor_type", "actor_id", "channel", "entered_at")
      SELECT "tenant_id", "id", "status"::text, "route"::text, 'backfill', 'system', NULL, 'system', "updated_at"
        FROM "loads"."loads"`);

    for (const [table, constraint, column, parent] of RESTRICTED_FKS) {
      await this.swapForeignKey(queryRunner, table, constraint, column, parent, 'RESTRICT');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, constraint, column, parent] of RESTRICTED_FKS) {
      await this.swapForeignKey(queryRunner, table, constraint, column, parent, 'CASCADE');
    }
    await queryRunner.query(`DROP TABLE "loads"."load_stage_history"`);
    await queryRunner.query(`DROP TYPE "loads"."load_stage_history_channel_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_stage_history_actor_type_enum"`);
  }

  private async swapForeignKey(
    queryRunner: QueryRunner,
    table: string,
    constraint: string,
    column: string,
    parent: string,
    onDelete: 'RESTRICT' | 'CASCADE',
  ): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."${table}" DROP CONSTRAINT "${constraint}"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."${table}" ADD CONSTRAINT "${constraint}" FOREIGN KEY ("${column}") REFERENCES "loads"."${parent}"("id") ON DELETE ${onDelete}`,
    );
  }
}
