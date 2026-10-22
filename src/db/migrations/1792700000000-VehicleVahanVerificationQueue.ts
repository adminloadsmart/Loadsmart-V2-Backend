import { MigrationInterface, QueryRunner } from 'typeorm';

// The fleet list's VAHAN badge. Mirrors the newest vehicle_verification_snapshots row (kept in
// sync by VehicleService.recordVerification): 'pending' while a bulk-imported truck waits on the
// 'vahan-verification' queue (one ULIP lookup per window), then verified / not_found /
// manual_review — with the reason in vahan_verification_error.
export class VehicleVahanVerificationQueue1792700000000 implements MigrationInterface {
  name = 'VehicleVahanVerificationQueue1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_vahan_verification_status_enum" AS ENUM('unverified', 'pending', 'verified', 'not_found', 'manual_review')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles"
        ADD "vahan_verification_status" "masters"."vehicles_vahan_verification_status_enum" NOT NULL DEFAULT 'unverified',
        ADD "vahan_verification_error" character varying(500),
        ADD "vahan_verified_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Existing trucks take their newest snapshot's status.
    await queryRunner.query(
      `UPDATE "masters"."vehicles" v
       SET "vahan_verification_status" = latest."verification_status"::text::"masters"."vehicles_vahan_verification_status_enum",
           "vahan_verified_at" = latest."verified_at"
       FROM (
         SELECT DISTINCT ON ("vehicle_id") "vehicle_id", "verification_status", "verified_at"
         FROM "masters"."vehicle_verification_snapshots"
         ORDER BY "vehicle_id", "created_at" DESC
       ) latest
       WHERE latest."vehicle_id" = v."id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles"
        DROP COLUMN "vahan_verified_at",
        DROP COLUMN "vahan_verification_error",
        DROP COLUMN "vahan_verification_status"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicles_vahan_verification_status_enum"`);
  }
}
