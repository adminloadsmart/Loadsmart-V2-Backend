import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Log a call (load module spec p.36, p.27 "Call log"): every call any team makes about a load —
 * who was spoken to, by whom, what was discussed, the outcome and an optional reminder — saved on
 * the load and noted on its timeline (CALL_LOGGED). Knowlarity will log calls automatically later.
 */
export class CreateLoadCalls1794400000000 implements MigrationInterface {
  name = 'CreateLoadCalls1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'CALL_LOGGED'`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."load_calls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "called_by_user_id" uuid NOT NULL,
        "team" varchar(32) NOT NULL,
        "parties" jsonb NOT NULL,
        "notes" text NOT NULL,
        "outcome" varchar(16) NOT NULL,
        "price" numeric(12,2),
        "reminder_at" TIMESTAMP WITH TIME ZONE,
        "reminder_done_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_calls_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_calls_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "load_calls_load_idx" ON "loads"."load_calls" ("load_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_calls_open_reminder_idx" ON "loads"."load_calls" ("called_by_user_id", "reminder_at") WHERE "reminder_at" IS NOT NULL AND "reminder_done_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "loads"."load_calls"`);
    // 'CALL_LOGGED' stays on load_activities_action_enum — Postgres can't drop an enum value.
  }
}
