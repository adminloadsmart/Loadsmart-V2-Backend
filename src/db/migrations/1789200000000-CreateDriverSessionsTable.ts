import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver-app sessions — the driver-identity counterpart to auth.refresh_tokens, but deliberately
// a separate table in the masters schema (alongside masters.drivers), not a row in
// auth.refresh_tokens: a driver is not an auth.users row (see docs/driver-auth.md). Same
// session/device/FCM shape as auth.refresh_tokens (see 1788775962337-
// AddSessionDeviceFieldsToRefreshTokens.ts) minus `portal` (drivers only ever have one), and
// `token_hash` here backs an opaque refresh secret the same way, not a JWT.
export class CreateDriverSessionsTable1789200000000 implements MigrationInterface {
  name = 'CreateDriverSessionsTable1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "driver_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "fcm_token" character varying(512), "device_type" character varying, "device_info" character varying, "ip_address" character varying, "last_seen" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f1e6f2f2e6d4c2b8a9d0e3c4b5a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_sessions_driver_id_idx" ON "masters"."driver_sessions" ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_sessions_token_hash_idx" ON "masters"."driver_sessions" ("token_hash")`,
    );
    // RESTRICT, same as every other FK onto masters.drivers(id) (driver_documents,
    // driver_bank_details, fleet_driver_links, loads.driver_id, ...) — drivers are only ever
    // soft-deleted, so this is this schema's safety net against a real hard delete silently
    // wiping session history instead of failing loudly.
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions" ADD CONSTRAINT "FK_a4b5c6d7e8f9a0b1c2d3e4f5a6b7" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions" DROP CONSTRAINT "FK_a4b5c6d7e8f9a0b1c2d3e4f5a6b7"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_sessions_token_hash_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_sessions_driver_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_sessions"`);
  }
}
