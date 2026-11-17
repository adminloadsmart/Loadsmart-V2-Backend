import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Edit and cancel a load (Figma discussion, 16 Nov).
 *
 * - A new `cancelled` status outside the 13 stages, with when it was cancelled and the stage it was
 *   cancelled from (the stepper stops there).
 * - load_cancellations also holds whole-load cancellations (`kind`), and a cancellation of a load
 *   Loadsmart has won waits for Super Admin (`status` pending → approved / rejected). Truck
 *   cancellations keep `next_step`; a load cancellation has none.
 * - Load timeline actions for cancelling and editing.
 */
export class LoadEditAndCancel1795100000000 implements MigrationInterface {
  name = 'LoadEditAndCancel1795100000000';
  // The route CHECK uses the new `cancelled` value, which Postgres only allows once the value is
  // committed — so the values go in first, outside the transaction.
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
    for (const action of [
      'LOAD_CANCELLED',
      'LOAD_CANCEL_REQUESTED',
      'LOAD_CANCEL_REJECTED',
      'LOAD_EDITED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
    await queryRunner.startTransaction();
    try {
      await this.upInTransaction(queryRunner);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  private async upInTransaction(queryRunner: QueryRunner): Promise<void> {
    // A load cancelled before any award has no route.
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_route_known_after_award"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "loads_route_known_after_award" CHECK ("route" IS NOT NULL OR "status" IN ('created', 'bids_received', 'cancelled'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "cancelled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "cancelled_from_stage" character varying(32)`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."load_cancellations_kind_enum" AS ENUM('truck', 'load')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cancellations" ADD "kind" "loads"."load_cancellations_kind_enum" NOT NULL DEFAULT 'truck'`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_cancellations_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cancellations" ADD "status" "loads"."load_cancellations_status_enum" NOT NULL DEFAULT 'approved'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_cancellations" ADD "decided_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cancellations" ADD "decided_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_cancellations" ADD "decision_note" text`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cancellations" ALTER COLUMN "next_step" DROP NOT NULL`,
    );
    // One request waiting per load at a time.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_cancellations_one_pending_per_load" ON "loads"."load_cancellations" ("load_id") WHERE "status" = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.startTransaction();
    try {
      await this.downInTransaction(queryRunner);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  private async downInTransaction(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "loads"."load_cancellations_one_pending_per_load"`);
    // Whole-load cancellations have no place in the old shape.
    await queryRunner.query(`DELETE FROM "loads"."load_cancellations" WHERE "kind" = 'load'`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cancellations" ALTER COLUMN "next_step" SET NOT NULL`,
    );
    for (const column of ['decision_note', 'decided_at', 'decided_by', 'status', 'kind']) {
      await queryRunner.query(`ALTER TABLE "loads"."load_cancellations" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "loads"."load_cancellations_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_cancellations_kind_enum"`);
    // A cancelled load goes back to Created; the enum values stay (Postgres can't drop them).
    await queryRunner.query(
      `UPDATE "loads"."loads" SET "status" = 'created' WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_route_known_after_award"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "loads_route_known_after_award" CHECK ("route" IS NOT NULL OR "status" IN ('created', 'bids_received'))`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "cancelled_from_stage"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "cancelled_at"`);
  }
}
