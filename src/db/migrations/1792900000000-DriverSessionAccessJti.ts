import { MigrationInterface, QueryRunner } from 'typeorm';

// One login per driver: a new login revokes the driver's other sessions and blocklists their
// access tokens right away (same blockToken as logout), instead of letting them run out their
// remaining access-token lifetime. Each session row matches exactly one access token, so the row now records
// that token's jti and expiry. Existing rows keep nulls — their tokens just expire as before.
export class DriverSessionAccessJti1792900000000 implements MigrationInterface {
  name = 'DriverSessionAccessJti1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions"
        ADD "access_jti" varchar,
        ADD "access_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions"
        DROP COLUMN "access_expires_at",
        DROP COLUMN "access_jti"`,
    );
  }
}
