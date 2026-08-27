import { MigrationInterface, QueryRunner } from 'typeorm';

// Three hot-path tables with no supporting index beyond their primary key:
// - masters.fleet_driver_links: no DB-level backstop for "at most one active primary driver per
//   vehicle" (fleet-driver-link.service.ts's linkDriver/setPrimaryDriver check-then-act inside a
//   transaction, but two concurrent calls can both pass that check before either commits).
// - auth.refresh_tokens: token_hash (every /auth/refresh, /auth/logout) and user_id
//   (revokeAllRefreshTokensForUser) both ran a full table scan.
// - auth.login_attempts: countRecentFailedAttempts (the brute-force lockout check itself) ran a
//   full table scan on an ever-growing, never-pruned table.
export class AddMissingAuthAndFleetIndexes1787900000000 implements MigrationInterface {
  name = 'AddMissingAuthAndFleetIndexes1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "fleet_driver_links_vehicle_active_primary_unique" ON "masters"."fleet_driver_links" ("tenant_id", "vehicle_id") WHERE "is_primary" = true AND "status" = 'active' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "refresh_tokens_token_hash_idx" ON "auth"."refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "auth"."refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "login_attempts_email_ip_success_created_idx" ON "auth"."login_attempts" ("email", "ip_address", "success", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "auth"."login_attempts_email_ip_success_created_idx"`);
    await queryRunner.query(`DROP INDEX "auth"."refresh_tokens_user_id_idx"`);
    await queryRunner.query(`DROP INDEX "auth"."refresh_tokens_token_hash_idx"`);
    await queryRunner.query(
      `DROP INDEX "masters"."fleet_driver_links_vehicle_active_primary_unique"`,
    );
  }
}
