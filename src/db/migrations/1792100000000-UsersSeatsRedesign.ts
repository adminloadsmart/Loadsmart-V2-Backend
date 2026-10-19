import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign — Users & Roles: "Based at" (a loading point) and last sign-in on users
// (backfilled from the oldest-to-newest refresh tokens: every login issues one, revoked ones are
// kept), and "Seats on the plan" on organizations (null → DEFAULT_ORG_SEAT_LIMIT).
export class UsersSeatsRedesign1792100000000 implements MigrationInterface {
  name = 'UsersSeatsRedesign1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth"."users"
        ADD "based_at_loading_point_id" uuid,
        ADD "last_signed_in_at" TIMESTAMP WITH TIME ZONE,
        ADD CONSTRAINT "FK_users_based_at_loading_point" FOREIGN KEY ("based_at_loading_point_id") REFERENCES "masters"."loading_points"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "auth"."users" u SET "last_signed_in_at" = t.last_at
      FROM (SELECT "user_id", MAX("created_at") AS last_at FROM "auth"."refresh_tokens" GROUP BY "user_id") t
      WHERE u."id"::text = t."user_id"::text
    `);
    await queryRunner.query(`ALTER TABLE "auth"."organizations" ADD "seat_limit" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" DROP COLUMN "seat_limit"`);
    await queryRunner.query(`
      ALTER TABLE "auth"."users"
        DROP CONSTRAINT "FK_users_based_at_loading_point",
        DROP COLUMN "last_signed_in_at",
        DROP COLUMN "based_at_loading_point_id"
    `);
  }
}
