import { MigrationInterface, QueryRunner } from 'typeorm';

// Detention terms (LS_N_0023 at loading, LS_N_0032 at unloading), per company, with the defaults
// in the database: 4 free hours at the loading point, 4 at the delivery point (a customer's own
// "free hours at drop" overrides it), ₹500 an hour beyond them. Kept on the organization so its
// admin can change them later from Settings.
//
// loads.departed_drop_at: when the vehicle left the delivery point's geofence (tracking's
// `trip.departed_drop`) — ends unloading detention and completes the trip (LS_N_0033).
export class AddDetentionTermsAndDropDeparture1792500000000 implements MigrationInterface {
  name = 'AddDetentionTermsAndDropDeparture1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations"
         ADD COLUMN IF NOT EXISTS "loading_free_hours" integer NOT NULL DEFAULT 4,
         ADD COLUMN IF NOT EXISTS "unloading_free_hours" integer NOT NULL DEFAULT 4,
         ADD COLUMN IF NOT EXISTS "detention_rate_per_hour" numeric(10,2) NOT NULL DEFAULT 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD COLUMN IF NOT EXISTS "departed_drop_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN IF EXISTS "departed_drop_at"`);
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations"
         DROP COLUMN IF EXISTS "detention_rate_per_hour",
         DROP COLUMN IF EXISTS "unloading_free_hours",
         DROP COLUMN IF EXISTS "loading_free_hours"`,
    );
  }
}
