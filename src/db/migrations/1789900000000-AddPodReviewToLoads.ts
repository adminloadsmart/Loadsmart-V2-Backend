import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver-app "Open Trips" feature: adds the E-POD staff-review state (podStatus/
// podRejectionReason/podReviewedAt/podReviewedBy) — previously a load closed the instant an
// E-POD was uploaded (or, for own-fleet, auto-closed with no review at all); now closing requires
// podStatus === 'accepted', set via the new PATCH /loads/:loadId/pod/review endpoint. Also
// extends load_activities_action_enum with 'POD_REVIEWED', same technique 1789400000000 used for
// 'ISSUE_REPORTED'.
export class AddPodReviewToLoads1789900000000 implements MigrationInterface {
  name = 'AddPodReviewToLoads1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_pod_status_enum" AS ENUM('pending', 'accepted', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "pod_status" "loads"."loads_pod_status_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "pod_rejection_reason" text`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "pod_reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "pod_reviewed_by" uuid`);
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'POD_REVIEWED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_reviewed_by"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_reviewed_at"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_status"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_pod_status_enum"`);
    // 'POD_REVIEWED' stays on load_activities_action_enum — Postgres can't drop an enum value,
    // same as every other migration here that's ever added one (see 1789400000000's down).
  }
}
